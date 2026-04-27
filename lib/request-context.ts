/**
 * Request-scoped tracing context.
 *
 * Provides a small, framework-agnostic distributed tracing layer that propagates
 * a request identifier and a W3C-compatible trace context (`traceparent`) through
 * incoming HTTP requests and any async work spawned from them.
 *
 * Highlights:
 *   - Honors inbound `X-Request-ID` and `traceparent` headers when present.
 *   - Generates fresh, well-formed identifiers when they are missing.
 *   - Exposes an `AsyncLocalStorage` so that downstream code (logging, DB calls,
 *     outbound `fetch`) can attach the same trace identifiers without threading
 *     a parameter through every function.
 *   - Provides `withRequestTracing` for Next.js route handlers and
 *     `applyTraceResponseHeaders` for direct integration with `NextResponse`.
 *
 * Server-only. Do not import from client components — this module relies on
 * `node:async_hooks` and `node:crypto`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';
export const TRACEPARENT_HEADER = 'traceparent';
export const TRACESTATE_HEADER = 'tracestate';

const HEX_RE = /^[0-9a-f]+$/i;

export interface RequestContext {
  /** Stable identifier for the current logical request (UUID by default). */
  requestId: string;
  /** 32-char hex W3C trace id; either inherited or freshly generated. */
  traceId: string;
  /** 16-char hex span id assigned to the current request. */
  spanId: string;
  /** When set, the inbound parent span id we are continuing from. */
  parentSpanId?: string;
  /** Trace flags from the inbound traceparent (defaults to `01` = sampled). */
  flags: string;
  /** Optional tracestate string forwarded from the inbound request. */
  traceState?: string;
  /** When the context was created (ms since epoch). */
  startedAt: number;
}

export interface ParsedTraceparent {
  traceId: string;
  spanId: string;
  flags: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

function isHex(value: string, length: number): boolean {
  return value.length === length && HEX_RE.test(value);
}

function isAllZero(value: string): boolean {
  return /^0+$/.test(value);
}

/** Generate a 16-byte (32 hex chars) trace id. */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Generate an 8-byte (16 hex chars) span id. */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** Generate a stable, opaque request identifier. */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Parse a W3C `traceparent` header. Returns `null` when malformed so callers can
 * decide whether to start a fresh trace.
 *
 * Format: `00-<32-hex trace id>-<16-hex parent id>-<2-hex flags>`
 */
export function parseTraceparent(value: string | null | undefined): ParsedTraceparent | null {
  if (!value) return null;
  const parts = value.trim().split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version !== '00') return null;
  if (!isHex(traceId, 32) || isAllZero(traceId)) return null;
  if (!isHex(spanId, 16) || isAllZero(spanId)) return null;
  if (!isHex(flags, 2)) return null;
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    flags: flags.toLowerCase(),
  };
}

/** Build a W3C-compliant `traceparent` header string. */
export function formatTraceparent(traceId: string, spanId: string, flags: string = '01'): string {
  return `00-${traceId}-${spanId}-${flags}`;
}

export interface CreateContextOptions {
  requestId?: string | null;
  traceparent?: string | null;
  traceState?: string | null;
}

/**
 * Build a {@link RequestContext} from optional inbound trace metadata.
 *
 * - When `traceparent` parses successfully we keep the trace id and treat the
 *   inbound span id as our parent.
 * - When it does not parse we start a fresh trace.
 */
export function createRequestContext(options: CreateContextOptions = {}): RequestContext {
  const parsed = parseTraceparent(options.traceparent);
  const traceId = parsed?.traceId ?? generateTraceId();
  const parentSpanId = parsed?.spanId;
  const flags = parsed?.flags ?? '01';
  const requestIdInput = options.requestId?.trim();
  const requestId =
    requestIdInput && requestIdInput.length > 0 ? requestIdInput : generateRequestId();
  return {
    requestId,
    traceId,
    spanId: generateSpanId(),
    parentSpanId,
    flags,
    traceState: options.traceState?.trim() || undefined,
    startedAt: Date.now(),
  };
}

/** Build a context from an incoming `Headers` instance. */
export function extractRequestContextFromHeaders(headers: Headers): RequestContext {
  return createRequestContext({
    requestId: headers.get(REQUEST_ID_HEADER),
    traceparent: headers.get(TRACEPARENT_HEADER),
    traceState: headers.get(TRACESTATE_HEADER),
  });
}

/** Run `fn` with `ctx` bound as the active request context. */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Returns the current request context, when one is active. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export function getSpanId(): string | undefined {
  return storage.getStore()?.spanId;
}

/**
 * Mutate `headers` in place to expose the trace identifiers to upstream callers.
 * Adds:
 *   - `X-Request-ID`: stable id for log correlation.
 *   - `traceparent`: W3C trace context with our span id.
 */
export function applyTraceResponseHeaders(headers: Headers, ctx: RequestContext): void {
  headers.set(REQUEST_ID_HEADER, ctx.requestId);
  headers.set(TRACEPARENT_HEADER, formatTraceparent(ctx.traceId, ctx.spanId, ctx.flags));
  if (ctx.traceState) {
    headers.set(TRACESTATE_HEADER, ctx.traceState);
  }
}

/** Build the outbound headers for a downstream `fetch` so the trace can continue. */
export function buildOutboundTraceHeaders(ctx?: RequestContext): Record<string, string> {
  const active = ctx ?? getRequestContext();
  if (!active) return {};
  const headers: Record<string, string> = {
    [REQUEST_ID_HEADER]: active.requestId,
    [TRACEPARENT_HEADER]: formatTraceparent(active.traceId, active.spanId, active.flags),
  };
  if (active.traceState) headers[TRACESTATE_HEADER] = active.traceState;
  return headers;
}

/**
 * Wrap a Next.js route handler so it runs inside a populated request context.
 * The returned handler also stamps `X-Request-ID` / `traceparent` onto the
 * response so clients and observability tooling can stitch the trace.
 */
export function withRequestTracing<Args extends unknown[], R extends Response>(
  handler: (req: Request, ...args: Args) => Promise<R> | R,
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req: Request, ...args: Args) => {
    const ctx = extractRequestContextFromHeaders(req.headers);
    return runWithRequestContext(ctx, async () => {
      try {
        const response = await handler(req, ...args);
        applyTraceResponseHeaders(response.headers, ctx);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const fallback = new Response(
          JSON.stringify({ error: message, requestId: ctx.requestId }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        );
        applyTraceResponseHeaders(fallback.headers, ctx);
        return fallback;
      }
    });
  };
}
