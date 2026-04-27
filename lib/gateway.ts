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

  const model = opts.llmConfig?.model || opts.model || getDefaultModel();

  // Reasoning models (MiniMax M2.x, OpenAI o1, DeepSeek-R1, Claude thinking) burn
  // a large chunk of the token budget on internal reasoning BEFORE emitting the
  // visible content. A small max_tokens truncates them mid-thought, so `content`
  // comes back null. They also often reject/ignore `response_format: json_object`.
  const isReasoningModel = /o1|r1|thinking|m2\.|reasoner/i.test(model);

  // Raise the floor for reasoning models so the visible answer actually gets emitted.
  const requestedMaxTokens = opts.maxTokens ?? 4000;
  const maxTokens = isReasoningModel ? Math.max(requestedMaxTokens, 2000) : requestedMaxTokens;

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: maxTokens,
  };

  // Only attach structured-output constraint for models that reliably support it.
  // MiniMax & other reasoning models tend to 403 / misbehave with json_object.
  if (opts.responseFormat === 'json_object' && !isReasoningModel) {
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

  let res: Response;
  try {
    res = await breaker.execute(async () => {
      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...buildOutboundTraceHeaders(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(55_000),
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
      return response;
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
    }
    throw error;
  }

  const data = await res.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason;
  const usage = data?.usage ?? {};

  if (typeof content === 'string' && content.length > 0) {
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
  const preview = JSON.stringify(data).slice(0, 600);
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
