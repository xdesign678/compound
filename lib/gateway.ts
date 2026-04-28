/**
 * Server-side helper for calling any OpenAI-compatible LLM API.
 * Runs only in Next.js API routes — API key is never exposed to the browser.
 *
 * Env vars:
 *   LLM_API_URL   – chat completions endpoint (default: OpenRouter)
 *   LLM_API_KEY   – API key for the endpoint
 *   LLM_MODEL     – model identifier (default: anthropic/claude-sonnet-4.6)
 *
 * Legacy fallback: AI_GATEWAY_API_KEY / AI_GATEWAY_URL are also accepted.
 */

import { promises as dns } from 'node:dns';
import net from 'node:net';
import { CircuitBreakerOpenError, getCircuitBreaker } from './circuit-breaker';
import { recordModelRun } from './model-runs';
import { logger } from './logging';
import { addBreadcrumb, reportError } from './observability/sentry';
import { buildOutboundTraceHeaders } from './request-context';

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'metadata.goog']);

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

async function validateApiUrl(url: string): Promise<void> {
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
    throw new Error('Invalid API URL: must be a public HTTPS endpoint');
  }

  if (net.isIP(rawHost)) {
    if (isBlockedIP(rawHost)) {
      throw new Error('Invalid API URL: must be a public HTTPS endpoint');
    }
    return;
  }

  // Resolve DNS and reject if ANY returned address sits in a blocked range.
  // Prevents DNS-rebinding / wildcard DNS pointing at internal hosts.
  // Controlled by COMPOUND_SKIP_DNS_GUARD=true for rare cases (never use in prod).
  if (process.env.COMPOUND_SKIP_DNS_GUARD === 'true') return;

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
      throw new Error('Invalid API URL: resolves to a blocked network range');
    }
  }
}

const HAPPYCAPY_GATEWAY = 'https://ai-gateway.happycapy.ai/api/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getGatewayUrl(): string {
  // Explicit URL always wins
  if (process.env.LLM_API_URL) return process.env.LLM_API_URL;
  // If user has set LLM_API_KEY, they're using OpenRouter (or custom)
  if (process.env.LLM_API_KEY) return OPENROUTER_URL;
  // Legacy: AI_GATEWAY_API_KEY → internal HappyCapy gateway (sandbox only)
  if (process.env.AI_GATEWAY_API_KEY) return HAPPYCAPY_GATEWAY;
  return OPENROUTER_URL;
}

function getDefaultModel(): string {
  return process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6';
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
 */
const LLM_TIMEOUT_MS = readPositiveInt(process.env.COMPOUND_LLM_TIMEOUT_MS, 180_000);
const LLM_REASONING_EXTRA_MS = readPositiveInt(process.env.COMPOUND_LLM_REASONING_EXTRA_MS, 60_000);

/**
 * Streaming idle timeout: abort the request if no SSE chunk arrives for this
 * long. Far smaller than the wall-clock cap because once tokens start flowing
 * a healthy model emits at least one chunk every few seconds.
 */
const LLM_STREAM_IDLE_MS = readPositiveInt(process.env.COMPOUND_LLM_STREAM_IDLE_MS, 45_000);

/**
 * Force-on / force-off streaming for reasoning models. Default = on, because
 * streaming converts "model thinks for 90s in silence then maybe times out"
 * into "we see a keepalive every few seconds and can wait the full budget".
 */
const LLM_STREAM_REASONING = readBool(process.env.COMPOUND_LLM_STREAM_REASONING, true);

/**
 * After this many consecutive `gateway timeout` errors against the same
 * model, automatically fall back to `COMPOUND_LLM_FALLBACK_MODEL` for the
 * NEXT call so the run can finish on a faster model. The counter resets to 0
 * on the first success.
 *
 * Set to 0 to disable auto-fallback entirely.
 */
const LLM_AUTO_FALLBACK_AFTER = readPositiveInt(process.env.COMPOUND_LLM_AUTO_FALLBACK_AFTER, 3);
const LLM_FALLBACK_MODEL =
  (process.env.COMPOUND_LLM_FALLBACK_MODEL || '').trim() || 'openai/gpt-4o-mini';

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

/** Exported for diagnostics endpoint / unit tests. */
export function getModelFailureSnapshot(): Array<{ model: string; consecutiveTimeouts: number }> {
  return Array.from(consecutiveTimeoutsByModel.entries())
    .filter(([, count]) => count > 0)
    .map(([model, consecutiveTimeouts]) => ({ model, consecutiveTimeouts }));
}

function shouldAutoFallback(model: string): boolean {
  if (LLM_AUTO_FALLBACK_AFTER <= 0) return false;
  if (model === LLM_FALLBACK_MODEL) return false;
  return (consecutiveTimeoutsByModel.get(model) ?? 0) >= LLM_AUTO_FALLBACK_AFTER;
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
  /**
   * Force streaming on/off. Default: streaming auto-enabled for reasoning
   * models (controlled by COMPOUND_LLM_STREAM_REASONING). Set explicitly to
   * `false` to opt out (e.g. for tests that want a deterministic full body).
   */
  stream?: boolean;
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

export async function chat(opts: ChatOptions): Promise<string> {
  // Strip quotes/whitespace that some hosting panels add to env vars
  const clean = (s?: string) => s?.replace(/^["'\s]+|["'\s]+$/g, '') || '';
  const userApiKey = clean(opts.llmConfig?.apiKey);
  const userApiUrl = clean(opts.llmConfig?.apiUrl);
  const serverApiKey = clean(process.env.LLM_API_KEY) || clean(process.env.AI_GATEWAY_API_KEY);

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

  const requestedModel = opts.llmConfig?.model || opts.model || getDefaultModel();

  // Auto-fallback: if recent calls to this model have all timed out, switch
  // to a known-fast fallback for THIS call so the batch can finish.
  const useFallback = shouldAutoFallback(requestedModel);
  const model = useFallback ? LLM_FALLBACK_MODEL : requestedModel;
  if (useFallback) {
    logger.warn('gateway.auto_fallback', {
      requestedModel,
      fallbackModel: model,
      reason: 'consecutive_timeouts',
      threshold: LLM_AUTO_FALLBACK_AFTER,
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

  await validateApiUrl(gatewayUrl);

  const startedAt = Date.now();
  const task = opts.task ?? 'chat';
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
  const wallClockTimeout = reasoning ? LLM_TIMEOUT_MS + LLM_REASONING_EXTRA_MS : LLM_TIMEOUT_MS;

  let streamedContent: string | null = null;
  let streamedFinishReason: string | null = null;
  let streamedUsage: Record<string, unknown> = {};

  let res: Response;
  try {
    res = await breaker.execute(async () => {
      // Build an AbortController with both wall-clock cap and per-chunk idle
      // reset for streaming mode.
      const controller = new AbortController();
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
              `LLM stream stalled (no chunk for ${LLM_STREAM_IDLE_MS}ms, model=${model})`,
              'TimeoutError',
            ),
          );
        }, LLM_STREAM_IDLE_MS);
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
          const errText = await response.text().catch(() => '');
          recordModelRun({
            model,
            task,
            latencyMs: Date.now() - startedAt,
            error: `gateway_${response.status}`,
          });
          throw new GatewayResponseError(response.status, errText.slice(0, 200));
        }

        if (wantStream && response.body) {
          const drained = await drainSSEStream(response.body, armIdle);
          streamedContent = drained.content;
          streamedFinishReason = drained.finishReason;
          streamedUsage = drained.usage;
        }
        return response;
      } finally {
        clearTimeout(wallTimer);
        if (idleTimer) clearTimeout(idleTimer);
      }
    });
  } catch (error) {
    if (error instanceof CircuitBreakerOpenError) {
      recordModelRun({
        model,
        task,
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
        latencyMs: Date.now() - startedAt,
        error: 'gateway_timeout',
      });
      logger.warn('gateway.timeout', {
        model,
        requestedModel,
        consecutiveTimeouts: consecutive,
        wallClockTimeoutMs: wallClockTimeout,
        streamIdleMs: wantStream ? LLM_STREAM_IDLE_MS : null,
        streamMode: wantStream,
        reasoning,
      });
    }
    throw error;
  }

  let content: string | null;
  let finishReason: string | null;
  let usage: Record<string, unknown>;
  let nonStreamData: unknown = null;

  if (wantStream) {
    content = streamedContent;
    finishReason = streamedFinishReason;
    usage = streamedUsage;
  } else {
    nonStreamData = await res.json();
    const choice = (
      nonStreamData as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      }
    )?.choices?.[0];
    content = choice?.message?.content ?? null;
    finishReason = choice?.finish_reason ?? null;
    usage = ((nonStreamData as { usage?: Record<string, unknown> })?.usage ?? {}) as Record<
      string,
      unknown
    >;
  }

  if (typeof content === 'string' && content.length > 0) {
    clearTimeoutsForModel(requestedModel);
    recordModelRun({
      model,
      task,
      inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
      outputTokens:
        typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
      latencyMs: Date.now() - startedAt,
    });
    return content;
  }

  // Diagnose why content is missing so the caller gets an actionable hint.
  if (finishReason === 'length') {
    recordModelRun({
      model,
      task,
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
    latencyMs: Date.now() - startedAt,
    error: 'unexpected_shape',
  });
  const preview = wantStream
    ? `[stream] finish_reason=${finishReason ?? 'null'} content_length=${(streamedContent ?? '').length}`
    : JSON.stringify(nonStreamData ?? {}).slice(0, 600);
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
