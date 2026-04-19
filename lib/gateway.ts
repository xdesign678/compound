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

const HAPPYCAPY_GATEWAY = 'https://ai-gateway.happycapy.ai/api/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getGatewayUrl(): string {
  if (process.env.LLM_API_URL) return process.env.LLM_API_URL;
  if (process.env.AI_GATEWAY_API_KEY) return HAPPYCAPY_GATEWAY;
  return OPENROUTER_URL;
}

function getDefaultModel(): string {
  return process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6';
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
}

export async function chat(opts: ChatOptions): Promise<string> {
  const apiKey = opts.llmConfig?.apiKey || process.env.LLM_API_KEY || process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY (or AI_GATEWAY_API_KEY) not set');
  }

  // If the user provided their own key but no explicit URL, default to OpenRouter.
  // Don't inherit the server-side URL (which may point to a private gateway).
  const gatewayUrl = opts.llmConfig?.apiUrl
    || (opts.llmConfig?.apiKey ? OPENROUTER_URL : getGatewayUrl());
  const model = opts.llmConfig?.model || opts.model || getDefaultModel();

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 4000,
  };

  if (opts.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Unexpected gateway response shape');
  }
  return content;
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
      console.error('[parseJSON] raw text:', text.slice(0, 500));
      console.error('[parseJSON] fixed text:', fixUnescapedQuotes(text).slice(0, 500));
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
        while (j < json.length && (json[j] === ' ' || json[j] === '\t' || json[j] === '\r' || json[j] === '\n')) j++;
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
          while (k < json.length && (json[k] === ' ' || json[k] === '\t' || json[k] === '\r' || json[k] === '\n')) k++;
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
            while (n < json.length && (json[n] === ' ' || json[n] === '\t' || json[n] === '\r' || json[n] === '\n')) n++;
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
