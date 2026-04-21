"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.chat = chat;
exports.parseJSON = parseJSON;
function validateApiUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error('Invalid API URL: must be a public HTTPS endpoint');
    }
    if (parsed.protocol !== 'https:') {
        throw new Error('Invalid API URL: must be a public HTTPS endpoint');
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block cloud metadata endpoints
    if (hostname === 'metadata.google.internal' || hostname === '169.254.169.254') {
        throw new Error('Invalid API URL: must be a public HTTPS endpoint');
    }
    // Block localhost hostnames
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') {
        throw new Error('Invalid API URL: must be a public HTTPS endpoint');
    }
    // Block private IP ranges
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
        const [, a, b] = ipv4Match.map(Number);
        const octets = ipv4Match.slice(1).map(Number);
        const [o1, o2] = octets;
        if (o1 === 127 || // 127.x.x.x — loopback
            o1 === 10 || // 10.x.x.x — private
            (o1 === 172 && o2 >= 16 && o2 <= 31) || // 172.16-31.x.x — private
            (o1 === 192 && o2 === 168) || // 192.168.x.x — private
            (o1 === 169 && o2 === 254) // 169.254.x.x — link-local / cloud metadata
        ) {
            throw new Error('Invalid API URL: must be a public HTTPS endpoint');
        }
    }
}
const HAPPYCAPY_GATEWAY = 'https://ai-gateway.happycapy.ai/api/v1/chat/completions';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
function getGatewayUrl() {
    // Explicit URL always wins
    if (process.env.LLM_API_URL)
        return process.env.LLM_API_URL;
    // If user has set LLM_API_KEY, they're using OpenRouter (or custom)
    if (process.env.LLM_API_KEY)
        return OPENROUTER_URL;
    // Legacy: AI_GATEWAY_API_KEY → internal HappyCapy gateway (sandbox only)
    if (process.env.AI_GATEWAY_API_KEY)
        return HAPPYCAPY_GATEWAY;
    return OPENROUTER_URL;
}
function getDefaultModel() {
    return process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6';
}
async function chat(opts) {
    // Strip quotes/whitespace that some hosting panels add to env vars
    const clean = (s) => s?.replace(/^["'\s]+|["'\s]+$/g, '') || '';
    const apiKey = clean(opts.llmConfig?.apiKey) || clean(process.env.LLM_API_KEY) || clean(process.env.AI_GATEWAY_API_KEY);
    if (!apiKey) {
        throw new Error('LLM_API_KEY (or AI_GATEWAY_API_KEY) not set');
    }
    // If the user provided their own key but no explicit URL, default to OpenRouter.
    // Don't inherit the server-side URL (which may point to a private gateway).
    const gatewayUrl = opts.llmConfig?.apiUrl
        || (opts.llmConfig?.apiKey ? OPENROUTER_URL : getGatewayUrl());
    const model = opts.llmConfig?.model || opts.model || getDefaultModel();
    // Reasoning models (MiniMax M2.x, OpenAI o1, DeepSeek-R1, Claude thinking) burn
    // a large chunk of the token budget on internal reasoning BEFORE emitting the
    // visible content. A small max_tokens truncates them mid-thought, so `content`
    // comes back null. They also often reject/ignore `response_format: json_object`.
    const isReasoningModel = /o1|r1|thinking|m2\.|reasoner/i.test(model);
    // Raise the floor for reasoning models so the visible answer actually gets emitted.
    const requestedMaxTokens = opts.maxTokens ?? 4000;
    const maxTokens = isReasoningModel
        ? Math.max(requestedMaxTokens, 2000)
        : requestedMaxTokens;
    const body = {
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
    validateApiUrl(gatewayUrl);
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
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    if (typeof content === 'string' && content.length > 0) {
        return content;
    }
    // Diagnose why content is missing so the caller gets an actionable hint.
    if (finishReason === 'length') {
        throw new Error(`Reasoning budget exhausted before content was emitted (finish_reason=length, model=${model}). ` +
            `Try raising max_tokens (>=2000 for reasoning models) or pick a non-reasoning model.`);
    }
    const preview = JSON.stringify(data).slice(0, 600);
    throw new Error(`Unexpected gateway response shape. Body preview: ${preview}`);
}
/**
 * Parses a JSON payload from an LLM response, tolerating code fences.
 */
function parseJSON(raw) {
    let text = raw.trim();
    // Strip ```json ... ``` fences
    const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fence)
        text = fence[1];
    // Strip leading/trailing prose if present — find the first {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        text = text.slice(firstBrace, lastBrace + 1);
    }
    try {
        return JSON.parse(text);
    }
    catch (e1) {
        // LLMs sometimes emit unescaped double-quotes inside JSON string values.
        // Walk the string with a state machine and fix them.
        try {
            return JSON.parse(fixUnescapedQuotes(text));
        }
        catch (e2) {
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
function fixUnescapedQuotes(json) {
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
            }
            else if (isKey) {
                // Key strings are always well-formed; end normally on any closing `"`
                inStr = false;
                isKey = false; // After a key comes a value
                out += ch;
            }
            else {
                // Value string — only end on `"` followed by a JSON structural boundary.
                // Look past whitespace to find the next non-whitespace char.
                let j = i + 1;
                while (j < json.length && (json[j] === ' ' || json[j] === '\t' || json[j] === '\r' || json[j] === '\n'))
                    j++;
                const next = json[j];
                if (next === '}' || next === ']' || j >= json.length) {
                    // Clear structural end → close the string
                    inStr = false;
                    out += ch;
                }
                else if (next === ',') {
                    // Ambiguous: `,` could be a JSON separator OR commas inside Chinese quoted text.
                    // Look further: if the pattern is `","key":` (a JSON key follows), end the string.
                    // If the pattern is `","non-key` (e.g. "概念A","概念B"), it's inside the value.
                    let k = j + 1;
                    while (k < json.length && (json[k] === ' ' || json[k] === '\t' || json[k] === '\r' || json[k] === '\n'))
                        k++;
                    const afterComma = json[k];
                    if (afterComma === '}' || afterComma === ']') {
                        // `",}` or `",]` — clear boundary
                        inStr = false;
                        out += ch;
                    }
                    else if (afterComma === '"') {
                        // After the comma is a `"`. Scan forward to find its matching `"` and check if
                        // it is followed by `:` (which would make it a JSON key, not array element or inline text).
                        let m = k + 1;
                        while (m < json.length && json[m] !== '"')
                            m++; // find closing `"` of potential key
                        let n = m + 1;
                        while (n < json.length && (json[n] === ' ' || json[n] === '\t' || json[n] === '\r' || json[n] === '\n'))
                            n++;
                        if (json[n] === ':') {
                            // Pattern `"value","key": → real JSON boundary
                            inStr = false;
                            out += ch;
                        }
                        else {
                            // Pattern `"概念A","概念B"` — unescaped quote inside value
                            out += '\\"';
                        }
                    }
                    else {
                        // `,` followed by non-quote non-brace → still inside value
                        out += '\\"';
                    }
                }
                else {
                    // Internal unescaped quote inside a value — escape it
                    out += '\\"';
                }
            }
        }
        else if (!inStr) {
            // Track structural chars to know when next string is a key vs value
            if (ch === ':') {
                isKey = false; // After `:`, next string is a value
            }
            else if (ch === ',' || ch === '{') {
                isKey = true; // After `,` or `{`, next string is a key
            }
            else if (ch === '[') {
                isKey = false; // Array elements are values
            }
            out += ch;
        }
        else {
            out += ch;
        }
        i++;
    }
    return out;
}
