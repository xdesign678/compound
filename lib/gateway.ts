/**
 * Server-side helper for calling any OpenAI-compatible LLM API.
 * Runs only in Next.js API routes — API key is never exposed to the browser.
 *
 * Env vars:
 *   LLM_API_URL   – chat completions endpoint (default: OpenRouter)
 *   LLM_API_KEY   – API key for the endpoint
 *   LLM_MODEL     – fallback model identifier (default: deepseek/deepseek-v4-flash)
 *
 * Legacy fallback: AI_GATEWAY_API_KEY / AI_GATEWAY_URL are also accepted.
 */

import { promises as dns } from 'node:dns';
import net from 'node:net';
import { CircuitBreakerOpenError, getCircuitBreaker } from './circuit-breaker';
import { recordModelRun } from './model-runs';
import { logger } from './logging';
import { recordLlmRetry, recordLlmSsrfBlock } from './observability/prometheus';
import { addBreadcrumb, reportError } from './observability/sentry';
import { buildOutboundTraceHeaders } from './request-context';
import { parseRateLimitBackoffMs } from './llm-rate-headers';
import { pauseLlmBudget, type LlmBudgetName } from './llm-budgets';
import { getModelForTask } from './model-history';

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'metadata.goog']);

function budgetForTask(task: string): LlmBudgetName | null {
  if (task === 'ingest') return 'github_ingest';
  if (task === 'contextualize-chunk') return 'contextualize';
  if (task === 'source_summarize') return 'summarize';
  if (task === 'relation_extract') return 'relations';
  return null;
}

function applyGatewayRateLimitHeaders(task: string, headers: Headers): void {
  const bucket = budgetForTask(task);
  if (!bucket) return;
  const backoffMs = parseRateLimitBackoffMs(headers, {
    remainingThreshold: 2,
    defaultBackoffMs: 30_000,
  });
  if (backoffMs == null) return;
  pauseLlmBudget(bucket, backoffMs);
  addBreadcrumb({
    category: 'llm-budget',
    level: 'warning',
    message: 'Paused LLM budget from provider rate-limit headers',
    data: { bucket, task, backoffMs },
  });
}

/**
 * IPv4 private / loopback / reserved ranges that must never be reached from the
 * server-side LLM bridge.
 */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    return true;
  }
  const [o1, o2] = parts;
  return (
    o1 === 0 || // 0.0.0.0/8 — "this network"
    o1 === 10 || // 10.0.0.0/8 — private
    o1 === 127 || // 127.0.0.0/8 — loopback
    (o1 === 100 && o2 >= 64 && o2 <= 127) || // 100.64.0.0/10 — CGN
    (o1 === 169 && o2 === 254) || // 169.254.0.0/16 — link-local / metadata
    (o1 === 172 && o2 >= 16 && o2 <= 31) || // 172.16.0.0/12 — private
    (o1 === 192 && o2 === 0) || // 192.0.0.0/24 — IETF protocol
    (o1 === 192 && o2 === 168) || // 192.168.0.0/16 — private
    (o1 === 198 && (o2 === 18 || o2 === 19)) // 198.18.0.0/15 — benchmark
  );
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80%')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — decay to IPv4 check.
  const mapped = lower.match(/^::ffff:([0-9a-f:.]+)$/);
  if (mapped) {
    const inner = mapped[1];
    if (net.isIPv4(inner)) return isBlockedIPv4(inner);
    return true;
  }
  return false;
}

function isBlockedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // unknown format — reject
}

export async function validatePublicHttpsApiUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid API URL: must be a public HTTPS endpoint');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Invalid API URL: must be a public HTTPS endpoint');
  }

  const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!rawHost) {
    throw new Error('Invalid API URL: must be a public HTTPS endpoint');
  }

  if (rawHost === 'localhost' || METADATA_HOSTS.has(rawHost)) {
    recordLlmSsrfBlock({ host: rawHost });
    throw new Error('Invalid API URL: must be a public HTTPS endpoint');
  }

  if (net.isIP(rawHost)) {
    if (isBlockedIP(rawHost)) {
      recordLlmSsrfBlock({ host: rawHost });
      throw new Error('Invalid API URL: must be a public HTTPS endpoint');
    }
    return;
  }

  // Resolve DNS and reject if ANY returned address sits in a blocked range.
  // Prevents DNS-rebinding / wildcard DNS pointing at internal hosts.
  // Controlled by COMPOUND_SKIP_DNS_GUARD=true for rare cases (never use in prod).
  //
  // Belt-and-braces: even if `instrumentation.ts` is somehow skipped (e.g.
  // programmatic server bootstrapping), reject the escape hatch here in
  // production so SSRF protection can't be disabled with a single env flag.
  if (process.env.COMPOUND_SKIP_DNS_GUARD === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('COMPOUND_SKIP_DNS_GUARD=true is not allowed in production (SSRF risk).');
    }
    return;
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await dns.lookup(rawHost, { all: true, verbatim: true });
  } catch {
    throw new Error('Invalid API URL: DNS resolution failed');
  }
  if (records.length === 0) {
    throw new Error('Invalid API URL: DNS returned no records');
  }
  for (const record of records) {
    if (isBlockedIP(record.address)) {
      recordLlmSsrfBlock({ host: rawHost });
      throw new Error('Invalid API URL: resolves to a blocked network range');
    }
  }
}

const HAPPYCAPY_GATEWAY = 'https://ai-gateway.happycapy.ai/api/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function cleanEnv(value: string | undefined): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') || '';
}

function getGatewayUrl(): string {
  // Explicit URL always wins
  const llmApiUrl = cleanEnv(process.env.LLM_API_URL);
  if (llmApiUrl) return llmApiUrl;
  const legacyGatewayUrl = cleanEnv(process.env.AI_GATEWAY_URL);
  if (legacyGatewayUrl) return legacyGatewayUrl;
  // If user has set LLM_API_KEY, they're using OpenRouter (or custom)
  if (cleanEnv(process.env.LLM_API_KEY)) return OPENROUTER_URL;
  // Legacy: AI_GATEWAY_API_KEY → internal HappyCapy gateway (sandbox only)
  if (cleanEnv(process.env.AI_GATEWAY_API_KEY)) return HAPPYCAPY_GATEWAY;
  return OPENROUTER_URL;
}

function getDefaultModel(task?: string): string {
  return getModelForTask(task);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

/**
 * Total wall-clock timeout for a non-streaming LLM call. Reasoning models that
 * spend tens of seconds on internal thinking before emitting visible content
 * get an extra `LLM_REASONING_EXTRA_MS` on top.
 *
 * Default raised from 120s → 180s (2026-04 incident: OpenRouter free-tier
 * reasoning models routinely take 60–120s on heavy ingest prompts; the old
 * 120s ceiling produced uniform timeouts on long batches).
 *
 * Read lazily so that tests can override via env vars without restarting the
 * process.
 */
function getLlmTimeoutMs(): number {
  return readPositiveInt(process.env.COMPOUND_LLM_TIMEOUT_MS, 180_000);
}
function getLlmReasoningExtraMs(): number {
  return readPositiveInt(process.env.COMPOUND_LLM_REASONING_EXTRA_MS, 60_000);
}

/**
 * Streaming idle timeout: abort the request if no SSE chunk arrives for this
 * long. Far smaller than the wall-clock cap because once tokens start flowing
 * a healthy model emits at least one chunk every few seconds.
 */
function getLlmStreamIdleMs(): number {
  return readPositiveInt(process.env.COMPOUND_LLM_STREAM_IDLE_MS, 45_000);
}

/**
 * Force-on / force-off streaming for reasoning models. Default = on, because
 * streaming converts "model thinks for 90s in silence then maybe times out"
 * into "we see a keepalive every few seconds and can wait the full budget".
 */
const LLM_STREAM_REASONING = readBool(process.env.COMPOUND_LLM_STREAM_REASONING, true);

/**
 * After this many consecutive `gateway timeout` errors against the same
 * model, the next call rotates to the *next* model in the configured fallback
 * list. The counter resets to 0 on the first success.
 *
 * Set `COMPOUND_LLM_AUTO_FALLBACK_AFTER=0` to disable auto-fallback entirely.
 */
const LLM_AUTO_FALLBACK_AFTER = readPositiveInt(process.env.COMPOUND_LLM_AUTO_FALLBACK_AFTER, 3);

/**
 * Comma-separated rotation list of fallback models. When the active model has
 * crossed the consecutive-timeout threshold, the gateway picks the next entry
 * that ISN'T currently above the threshold, falling back to
 * `COMPOUND_LLM_FALLBACK_MODEL` (single value, legacy) only if the list is
 * empty.
 *
 * Example for an OpenRouter setup with several reasoning models:
 *   COMPOUND_LLM_FALLBACK_MODELS=mimo-v2.5-pro,deepseek-v4-flash,deepseek-v4-pro,mimo-v2.5
 *
 * The legacy single-value `COMPOUND_LLM_FALLBACK_MODEL` is honored as the
 * trailing safety net (e.g. `openai/gpt-4o-mini`) so a deployment without the
 * new list still degrades gracefully.
 */
function parseModelList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const LLM_FALLBACK_MODELS = parseModelList(process.env.COMPOUND_LLM_FALLBACK_MODELS);
const LLM_FALLBACK_MODEL_LEGACY =
  (process.env.COMPOUND_LLM_FALLBACK_MODEL || '').trim() || 'openai/gpt-4o-mini';

/**
 * Build the effective fallback rotation: user-configured list + legacy single
 * value as a final safety net. De-duplicated, preserves order.
 */
function buildFallbackRotation(): string[] {
  const seen = new Set<string>();
  const rotation: string[] = [];
  for (const m of LLM_FALLBACK_MODELS) {
    if (!seen.has(m)) {
      seen.add(m);
      rotation.push(m);
    }
  }
  if (LLM_FALLBACK_MODEL_LEGACY && !seen.has(LLM_FALLBACK_MODEL_LEGACY)) {
    rotation.push(LLM_FALLBACK_MODEL_LEGACY);
  }
  return rotation;
}

/**
 * Detect "reasoning" / "thinking" model families. These models burn a large
 * chunk of the token budget on internal reasoning BEFORE emitting visible
 * content, so they need: bigger max_tokens floor, no `response_format:json`,
 * longer wall-clock timeout, and ideally streaming mode.
 *
 * Covered:
 *   - OpenAI o1 / o3 / o-mini
 *   - DeepSeek R1, R1-Lite
 *   - DeepSeek V3 / V4 reasoning variants (V3 onwards uses MoE + thinking)
 *   - MiniMax M2 / M2.x
 *   - Xiaomi MiMo (mimo-* / xiaomi-mimo-*)
 *   - Anthropic Claude *thinking*
 *   - Generic "*-reasoner" / "*-thinking" suffixed models
 */
export function isReasoningModel(model: string | null | undefined): boolean {
  if (!model) return false;
  const normalized = model.toLowerCase();
  if (/deepseek[\/\-]deepseek-v4-flash|deepseek-v4-flash/.test(normalized)) return false;
  return (
    /(?:^|[\/\-])o[1-9](?:[\.\-]|$)/.test(normalized) || // o1, o3-mini, o4
    /(?:^|[\/\-])r[1-9](?:[\.\-]|$)/.test(normalized) || // r1, r1-lite, r2
    /thinking|reasoner/.test(normalized) ||
    /deepseek[\/\-]?(?:v[3-9]|r[1-9])/.test(normalized) || // deepseek-v3+, deepseek-r1+
    /minimax[\/\-]?m[2-9]/.test(normalized) || // minimax-m2 / m2.5
    /(?:^|[\/\-])m[2-9](?:[\.\-]|$)/.test(normalized) || // bare m2 / m2.5
    /mimo/.test(normalized) // xiaomi mimo
  );
}

/**
 * Module-scope counter of consecutive timeout failures keyed by model. Lives
 * for the lifetime of the Node process — fine because we want fallback to
 * activate quickly within a single batch and reset across deploys.
 */
const consecutiveTimeoutsByModel = new Map<string, number>();

function recordTimeoutForModel(model: string): number {
  const next = (consecutiveTimeoutsByModel.get(model) ?? 0) + 1;
  consecutiveTimeoutsByModel.set(model, next);
  return next;
}

function clearTimeoutsForModel(model: string): void {
  if (consecutiveTimeoutsByModel.has(model)) {
    consecutiveTimeoutsByModel.set(model, 0);
  }
}

/**
 * Decide whether the gateway should swap models for the next call.
 *
 * Returns the model to use:
 *   - `model` itself when no fallback is needed (counter below threshold).
 *   - The next entry in the rotation that hasn't itself crossed the
 *     threshold yet, when the active model is over budget.
 *   - `null` when every candidate has already failed → caller proceeds with
 *     the original model and surfaces the failure to the user.
 *
 * Rotation order: user list (in order) → legacy single fallback. The active
 * model is skipped to avoid degenerate same-model retries.
 */
function pickFallbackModel(activeModel: string): string | null {
  if (LLM_AUTO_FALLBACK_AFTER <= 0) return null;
  const overBudget = (consecutiveTimeoutsByModel.get(activeModel) ?? 0) >= LLM_AUTO_FALLBACK_AFTER;
  if (!overBudget) return null;

  const rotation = buildFallbackRotation();
  for (const candidate of rotation) {
    if (candidate === activeModel) continue;
    const candidateFailures = consecutiveTimeoutsByModel.get(candidate) ?? 0;
    if (candidateFailures < LLM_AUTO_FALLBACK_AFTER) {
      return candidate;
    }
  }
  // Every fallback is also exhausted — let the active model fail loudly so
  // the diagnostics banner can prompt the operator to fix configuration.
  return null;
}

function isAbortTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name}|${error.message}`.toLowerCase();
  return (
    text.includes('timeouterror') ||
    text.includes('operation was aborted') ||
    text.includes('the user aborted') ||
    error.name === 'TimeoutError' ||
    error.name === 'AbortError'
  );
}

class GatewayResponseError extends Error {
  readonly status: number;

  constructor(status: number, bodyPreview: string) {
    super(`Gateway ${status}: ${bodyPreview}`);
    this.name = 'GatewayResponseError';
    this.status = status;
  }
}

/**
 * Read a Response body as text, racing against an AbortSignal.
 *
 * Node.js `fetch()` propagates the signal to the body stream, so in production
 * `response.text()` will naturally reject when the signal fires. However, when
 * the Response is constructed manually (e.g. in tests or edge-runtime shims),
 * the signal is NOT wired up. This helper explicitly races the body read against
 * the signal so that both real and mock fetches behave correctly.
 */
async function readBodyTextWithAbort(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
  // Race response.text() against the abort signal so the function can reject
  // promptly even when the body stream never completes (e.g. hanging upstream).
  // Using Promise.race ensures our returned promise settles on abort, while
  // the internal response.text() promise — which may still be pending because
  // the stream is locked by its own reader and cannot be cancelled via
  // body.cancel() — is simply orphaned and GC'd.
  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const textPromise = response.text();
  try {
    return await Promise.race([textPromise, abortPromise]);
  } finally {
    // Best-effort: cancel the underlying body stream so it stops reading
    // and doesn't continue consuming memory/CPU in the background.
    // This may silently fail when the stream is already locked by textPromise's
    // reader — that's fine; the orphaned textPromise will be GC'd.
    response.body?.cancel(signal.reason).catch(() => {});
  }
}

function isTransientGatewayFailure(error: unknown): boolean {
  if (error instanceof GatewayResponseError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof CircuitBreakerOpenError) return false;
  return error instanceof Error;
}

function circuitNameForGateway(url: string): string {
  try {
    const parsed = new URL(url);
    return `llm-gateway:${parsed.host}`;
  } catch {
    return 'llm-gateway:invalid-url';
  }
}

function metricHostForGateway(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  cache_control?: { type: 'ephemeral' };
}

export interface LlmConfigOverride {
  apiKey?: string;
  apiUrl?: string;
  model?: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
  llmConfig?: LlmConfigOverride;
  /** Short label identifying the pipeline stage for cost/telemetry (e.g. 'extract', 'synth'). */
  task?: string;
  /** Version of the system prompt used for this call. */
  promptVersion?: string;
  /**
   * Force streaming on/off. Default: streaming auto-enabled for reasoning
   * models (controlled by COMPOUND_LLM_STREAM_REASONING). Set explicitly to
   * `false` to opt out (e.g. for tests that want a deterministic full body).
   */
  stream?: boolean;
  /** Optional caller cancellation signal. Used by background jobs when a sync run is cancelled. */
  signal?: AbortSignal;
}

/**
 * Drain an OpenAI-compatible SSE stream into a single string. Resets the
 * idle-timeout AbortController on every chunk so a slowly-thinking reasoning
 * model can stream tokens for many minutes without tripping the timeout, as
 * long as it keeps emitting something.
 *
 * Returns the concatenated `delta.content` plus the final `finish_reason`
 * and `usage` block (when present) for telemetry parity with non-streamed
 * responses.
 */
async function drainSSEStream(
  body: ReadableStream<Uint8Array>,
  resetIdle: () => void,
): Promise<{ content: string; finishReason: string | null; usage: Record<string, unknown> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let finishReason: string | null = null;
  let usage: Record<string, unknown> = {};

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      // SSE separator is double newline; tolerate \r\n\r\n too.
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? '';
      for (const evt of events) {
        const lines = evt.split(/\r?\n/);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const choice = json?.choices?.[0];
            const deltaContent = choice?.delta?.content;
            if (typeof deltaContent === 'string') content += deltaContent;
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (json?.usage && typeof json.usage === 'object') {
              usage = { ...usage, ...(json.usage as Record<string, unknown>) };
            }
          } catch {
            // Some providers (OpenRouter free tier) intersperse comment frames
            // like `: OPENROUTER PROCESSING`. Safely ignored.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content, finishReason, usage };
}

function usageNumber(usage: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export async function chat(opts: ChatOptions): Promise<string> {
  // Strip quotes/whitespace that some hosting panels add to env vars
  const userApiKey = cleanEnv(opts.llmConfig?.apiKey);
  const userApiUrl = cleanEnv(opts.llmConfig?.apiUrl);
  const serverApiKey =
    cleanEnv(process.env.LLM_API_KEY) || cleanEnv(process.env.AI_GATEWAY_API_KEY);

  let apiKey: string;
  let gatewayUrl: string;

  if (userApiUrl) {
    if (!userApiKey) {
      throw new Error('Custom API URL requires a user-provided API key');
    }
    if (process.env.COMPOUND_ALLOW_CUSTOM_LLM_API_URL === 'false') {
      throw new Error('Custom API URL is disabled on this deployment');
    }
    apiKey = userApiKey;
    gatewayUrl = userApiUrl;
  } else if (userApiKey) {
    // If the user provided their own key but no explicit URL, default to OpenRouter.
    // Don't inherit the server-side URL (which may point to a private gateway).
    apiKey = userApiKey;
    gatewayUrl = OPENROUTER_URL;
  } else {
    apiKey = serverApiKey;
    gatewayUrl = getGatewayUrl();
  }

  if (!apiKey) {
    throw new Error('LLM_API_KEY (or AI_GATEWAY_API_KEY) not set');
  }

  const requestedModel = opts.llmConfig?.model || opts.model || getDefaultModel(opts.task);

  // Auto-fallback: if recent calls to this model have all timed out, rotate
  // to the next model in the configured list so the batch can keep moving.
  const fallbackChoice = pickFallbackModel(requestedModel);
  const model = fallbackChoice ?? requestedModel;
  if (fallbackChoice) {
    recordLlmRetry({ host: metricHostForGateway(gatewayUrl), reason: 'consecutive_timeouts' });
    logger.warn('gateway.auto_fallback', {
      requestedModel,
      fallbackModel: model,
      reason: 'consecutive_timeouts',
      threshold: LLM_AUTO_FALLBACK_AFTER,
      rotationSize: buildFallbackRotation().length,
    });
  }

  const reasoning = isReasoningModel(model);

  // Raise the floor for reasoning models so the visible answer actually gets emitted.
  const requestedMaxTokens = opts.maxTokens ?? 4000;
  const maxTokens = reasoning ? Math.max(requestedMaxTokens, 2000) : requestedMaxTokens;

  // Pick streaming mode: explicit override → user value, else auto-on for reasoning.
  const wantStream = opts.stream ?? (reasoning && LLM_STREAM_REASONING);

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: maxTokens,
  };

  if (wantStream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  // Only attach structured-output constraint for models that reliably support it.
  // MiniMax / DeepSeek-R / MiMo etc. tend to 403 / misbehave with json_object.
  if (opts.responseFormat === 'json_object' && !reasoning) {
    body.response_format = { type: 'json_object' };
  }

  await validatePublicHttpsApiUrl(gatewayUrl);

  const startedAt = Date.now();
  const task = opts.task ?? 'chat';
  const promptVersion = opts.promptVersion ?? 'unknown';
  const breaker = getCircuitBreaker({
    name: circuitNameForGateway(gatewayUrl),
    failureThreshold: readPositiveInt(process.env.COMPOUND_LLM_CIRCUIT_FAILURE_THRESHOLD, 3),
    resetTimeoutMs: readPositiveInt(process.env.COMPOUND_LLM_CIRCUIT_RESET_MS, 30_000),
    isFailure: isTransientGatewayFailure,
    onStateChange: (snapshot) => {
      logger.warn('gateway.circuit_state_changed', { ...snapshot });
    },
  });

  // Compute effective wall-clock budget. Reasoning models get extra time;
  // streaming mode also relies on per-chunk idle reset, so the total ceiling
  // is mostly a safety net.
  // Snapshot the lazy getters once per call so values are consistent within
  // this chat() invocation even if env vars change mid-request.
  const llmTimeoutMs = getLlmTimeoutMs();
  const llmReasoningExtraMs = getLlmReasoningExtraMs();
  const llmStreamIdleMs = getLlmStreamIdleMs();
  const wallClockTimeout = reasoning ? llmTimeoutMs + llmReasoningExtraMs : llmTimeoutMs;

  let streamedContent: string | null = null;
  let streamedFinishReason: string | null = null;
  let streamedUsage: Record<string, unknown> = {};
  // Non-streaming body is parsed inside breaker.execute() so the wall-clock
  // AbortController still covers the body-read phase. Previously the timer
  // was cleared in the `finally` block before res.json() ran outside, which
  // meant a hanging body would never time out.
  let nonStreamParsedData: unknown = null;

  let res: Response;
  try {
    res = await breaker.execute(async () => {
      // Build an AbortController with wall-clock cap, optional caller abort,
      // and per-chunk idle reset for streaming mode.
      const controller = new AbortController();
      const abortFromCaller = () => {
        const reason =
          opts.signal?.reason instanceof Error
            ? opts.signal.reason
            : new DOMException('LLM call aborted by caller', 'AbortError');
        controller.abort(reason);
      };
      if (opts.signal?.aborted) abortFromCaller();
      else opts.signal?.addEventListener('abort', abortFromCaller, { once: true });
      const wallTimer = setTimeout(() => {
        controller.abort(
          new DOMException(
            `LLM call exceeded wall-clock budget (${wallClockTimeout}ms, model=${model})`,
            'TimeoutError',
          ),
        );
      }, wallClockTimeout);

      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const armIdle = () => {
        if (!wantStream) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          controller.abort(
            new DOMException(
              `LLM stream stalled (no chunk for ${llmStreamIdleMs}ms, model=${model})`,
              'TimeoutError',
            ),
          );
        }, llmStreamIdleMs);
      };
      armIdle();

      try {
        const response = await fetch(gatewayUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...buildOutboundTraceHeaders(),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          applyGatewayRateLimitHeaders(task, response.headers);
          const errText = await response.text().catch(() => '');
          recordModelRun({
            model,
            task,
            promptVersion,
            latencyMs: Date.now() - startedAt,
            error: `gateway_${response.status}`,
          });
          throw new GatewayResponseError(response.status, errText.slice(0, 200));
        }

        applyGatewayRateLimitHeaders(task, response.headers);
        if (wantStream && response.body) {
          const drained = await drainSSEStream(response.body, armIdle);
          streamedContent = drained.content;
          streamedFinishReason = drained.finishReason;
          streamedUsage = drained.usage;
        } else {
          // Read body inside breaker.execute() while the wall-clock timer is
          // still armed, so a hanging body read gets aborted by the timer.
          // Read as text first, then parse — this gives us the raw body for
          // diagnostics when the upstream returns non-JSON on a 200 status.
          // readBodyTextWithAbort races the body read against the signal so
          // that both real fetch() and manually-constructed Responses respect
          // the abort.
          const textBody = await readBodyTextWithAbort(response, controller.signal);
          try {
            nonStreamParsedData = JSON.parse(textBody);
          } catch {
            throw new GatewayResponseError(
              response.status,
              `Non-JSON body (first 200 chars): ${textBody.slice(0, 200)}`,
            );
          }
        }
        return response;
      } finally {
        opts.signal?.removeEventListener('abort', abortFromCaller);
        clearTimeout(wallTimer);
        if (idleTimer) clearTimeout(idleTimer);
      }
    });
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      recordModelRun({
        model,
        task,
        promptVersion,
        latencyMs: Date.now() - startedAt,
        error: 'circuit_open',
      });
      logger.warn('gateway.circuit_open', {
        service: error.service,
        retryAfterMs: error.retryAfterMs,
      });
    } else if (isAbortTimeoutError(error)) {
      const consecutive = recordTimeoutForModel(requestedModel);
      recordModelRun({
        model,
        task,
        promptVersion,
        latencyMs: Date.now() - startedAt,
        error: 'gateway_timeout',
      });
      logger.warn('gateway.timeout', {
        model,
        requestedModel,
        consecutiveTimeouts: consecutive,
        wallClockTimeoutMs: wallClockTimeout,
        streamIdleMs: wantStream ? llmStreamIdleMs : null,
        streamMode: wantStream,
        reasoning,
      });
    }
    throw error;
  }

  let content: string | null;
  let finishReason: string | null;
  let usage: Record<string, unknown>;

  if (wantStream) {
    content = streamedContent;
    finishReason = streamedFinishReason;
    usage = streamedUsage;
  } else {
    // Body was already parsed inside breaker.execute(); use the stored data.
    const choice = (
      nonStreamParsedData as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      }
    )?.choices?.[0];
    content = choice?.message?.content ?? null;
    finishReason = choice?.finish_reason ?? null;
    usage = ((nonStreamParsedData as { usage?: Record<string, unknown> })?.usage ?? {}) as Record<
      string,
      unknown
    >;
  }

  if (typeof content === 'string' && content.length > 0) {
    clearTimeoutsForModel(requestedModel);
    recordModelRun({
      model,
      task,
      promptVersion,
      inputTokens: usageNumber(usage, ['prompt_tokens', 'input_tokens']),
      outputTokens: usageNumber(usage, ['completion_tokens', 'output_tokens']),
      latencyMs: Date.now() - startedAt,
      costUsd: usageNumber(usage, ['cost', 'cost_usd', 'total_cost']),
    });
    return content;
  }

  // Diagnose why content is missing so the caller gets an actionable hint.
  if (finishReason === 'length') {
    recordModelRun({
      model,
      task,
      promptVersion,
      latencyMs: Date.now() - startedAt,
      error: 'finish_length',
    });
    throw new Error(
      `Reasoning budget exhausted before content was emitted (finish_reason=length, model=${model}). ` +
        `Try raising max_tokens (>=2000 for reasoning models) or pick a non-reasoning model.`,
    );
  }

  recordModelRun({
    model,
    task,
    promptVersion,
    latencyMs: Date.now() - startedAt,
    error: 'unexpected_shape',
  });
  const preview = wantStream
    ? `[stream] finish_reason=${finishReason ?? 'null'} content_length=${(streamedContent ?? '').length}`
    : JSON.stringify(nonStreamParsedData ?? {}).slice(0, 600);
  throw new Error(`Unexpected gateway response shape. Body preview: ${preview}`);
}

/**
 * Parses a JSON payload from an LLM response, tolerating code fences.
 */
export function parseJSON<T>(raw: string): T {
  let text = raw.trim();
  // Strip ```json ... ``` fences
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  // Strip leading/trailing prose if present — find the first {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  try {
    return JSON.parse(text) as T;
  } catch (e1) {
    // LLMs sometimes emit unescaped double-quotes inside JSON string values.
    // Walk the string with a state machine and fix them.
    try {
      return JSON.parse(fixUnescapedQuotes(text)) as T;
    } catch (e2) {
      logger.error('gateway.parse_json_failed', {
        rawPreview: text.slice(0, 500),
        fixedPreview: fixUnescapedQuotes(text).slice(0, 500),
      });
      throw e2;
    }
  }
}

/**
 * State-machine fix for LLM-emitted JSON that contains unescaped " inside string values.
 *
 * Key insight: only VALUE strings can contain unescaped quotes (LLMs never put bad chars
 * in short key names). Value strings end only at `"` followed by `,`, `}`, or `]`.
 * Key strings end at `"` followed by `:`.
 */
function fixUnescapedQuotes(json: string): string {
  let out = '';
  let i = 0;
  let inStr = false;
  let isKey = true; // Whether the current string is a key (true) or value (false)

  while (i < json.length) {
    const ch = json[i];

    if (ch === '\\' && inStr) {
      // Existing escape sequence — copy both chars
      out += ch + (json[i + 1] ?? '');
      i += 2;
      continue;
    }

    if (ch === '"') {
      if (!inStr) {
        inStr = true;
        out += ch;
      } else if (isKey) {
        // Key strings are always well-formed; end normally on any closing `"`
        inStr = false;
        isKey = false; // After a key comes a value
        out += ch;
      } else {
        // Value string — only end on `"` followed by a JSON structural boundary.
        // Look past whitespace to find the next non-whitespace char.
        let j = i + 1;
        while (
          j < json.length &&
          (json[j] === ' ' || json[j] === '\t' || json[j] === '\r' || json[j] === '\n')
        )
          j++;
        const next = json[j];

        if (next === '}' || next === ']' || j >= json.length) {
          // Clear structural end → close the string
          inStr = false;
          out += ch;
        } else if (next === ',') {
          // Ambiguous: `,` could be a JSON separator OR commas inside Chinese quoted text.
          // Look further: if the pattern is `","key":` (a JSON key follows), end the string.
          // If the pattern is `","non-key` (e.g. "概念A","概念B"), it's inside the value.
          let k = j + 1;
          while (
            k < json.length &&
            (json[k] === ' ' || json[k] === '\t' || json[k] === '\r' || json[k] === '\n')
          )
            k++;
          const afterComma = json[k];
          if (afterComma === '}' || afterComma === ']') {
            // `",}` or `",]` — clear boundary
            inStr = false;
            out += ch;
          } else if (afterComma === '"') {
            // After the comma is a `"`. Scan forward to find its matching `"` and check if
            // it is followed by `:` (which would make it a JSON key, not array element or inline text).
            let m = k + 1;
            while (m < json.length && json[m] !== '"') m++; // find closing `"` of potential key
            let n = m + 1;
            while (
              n < json.length &&
              (json[n] === ' ' || json[n] === '\t' || json[n] === '\r' || json[n] === '\n')
            )
              n++;
            if (json[n] === ':') {
              // Pattern `"value","key": → real JSON boundary
              inStr = false;
              out += ch;
            } else {
              // Pattern `"概念A","概念B"` — unescaped quote inside value
              out += '\\"';
            }
          } else {
            // `,` followed by non-quote non-brace → still inside value
            out += '\\"';
          }
        } else {
          // Internal unescaped quote inside a value — escape it
          out += '\\"';
        }
      }
    } else if (!inStr) {
      // Track structural chars to know when next string is a key vs value
      if (ch === ':') {
        isKey = false; // After `:`, next string is a value
      } else if (ch === ',' || ch === '{') {
        isKey = true; // After `,` or `{`, next string is a key
      } else if (ch === '[') {
        isKey = false; // Array elements are values
      }
      out += ch;
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}
