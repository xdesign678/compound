import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'compound_admin_token';
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const REQUEST_ID_HEADER = 'x-request-id';
const TRACEPARENT_HEADER = 'traceparent';

const HEX_RE = /^[0-9a-f]+$/i;
const REQUEST_ID_MAX_LEN = 128;

/** Reject suspicious / malformed inbound request ids and fall back to a fresh one. */
function normalizeInboundRequestId(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > REQUEST_ID_MAX_LEN) return null;
  // Allow UUIDs or short opaque tokens; strip any control characters.
  if (!/^[\w.\-:]+$/.test(trimmed)) return null;
  return trimmed;
}

function generateRequestId(): string {
  // Edge runtime exposes Web Crypto's randomUUID via the global `crypto`.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback that still produces a UUID-like string in case `randomUUID` is unavailable.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isValidTraceparent(value: string | null): value is string {
  if (!value) return false;
  const parts = value.trim().split('-');
  if (parts.length !== 4) return false;
  const [version, traceId, spanId, flags] = parts;
  if (version !== '00') return false;
  if (traceId.length !== 32 || !HEX_RE.test(traceId) || /^0+$/.test(traceId)) return false;
  if (spanId.length !== 16 || !HEX_RE.test(spanId) || /^0+$/.test(spanId)) return false;
  if (flags.length !== 2 || !HEX_RE.test(flags)) return false;
  return true;
}

interface TraceMeta {
  requestId: string;
  traceparent: string | null;
  inboundRequestId: string | null;
}

function readTraceMeta(req: NextRequest): TraceMeta {
  const inbound = normalizeInboundRequestId(req.headers.get(REQUEST_ID_HEADER));
  const requestId = inbound ?? generateRequestId();
  // Cap inbound traceparent length defensively before validation.
  const rawTraceparent = req.headers.get(TRACEPARENT_HEADER);
  const traceparent = rawTraceparent && rawTraceparent.length <= 128 && isValidTraceparent(rawTraceparent)
    ? rawTraceparent
    : null;
  return { requestId, traceparent, inboundRequestId: inbound };
}

function withTraceHeaders(res: NextResponse, meta: TraceMeta): NextResponse {
  res.headers.set(REQUEST_ID_HEADER, meta.requestId);
  if (meta.traceparent) {
    res.headers.set(TRACEPARENT_HEADER, meta.traceparent);
  }
  return res;
}

function nextWithTrace(req: NextRequest, meta: TraceMeta): NextResponse {
  // Re-stamp the headers we forward to downstream Next.js handlers so the
  // route can read the same identifiers we put on the response.
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, meta.requestId);
  if (meta.traceparent) {
    forwardedHeaders.set(TRACEPARENT_HEADER, meta.traceparent);
  } else {
    forwardedHeaders.delete(TRACEPARENT_HEADER);
  }
  return withTraceHeaders(
    NextResponse.next({ request: { headers: forwardedHeaders } }),
    meta
  );
}



function clean(value: string | undefined): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') ?? '';
}

function getAdminToken(): string {
  return clean(process.env.COMPOUND_ADMIN_TOKEN) || clean(process.env.ADMIN_TOKEN);
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function decodeBasicToken(value: string): string {
  try {
    const decoded = atob(value);
    const separator = decoded.indexOf(':');
    if (separator === -1) return decoded.trim();
    return decoded.slice(separator + 1).trim();
  } catch {
    return '';
  }
}

function getProvidedToken(req: NextRequest): string {
  const direct = req.headers.get('x-compound-admin-token')?.trim();
  if (direct) return direct;

  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  if (auth.startsWith('Basic ')) return decodeBasicToken(auth.slice('Basic '.length));

  return req.cookies.get(AUTH_COOKIE_NAME)?.value.trim() ?? '';
}

function withAuthCookie(req: NextRequest, res: NextResponse, token: string): NextResponse {
  const existing = req.cookies.get(AUTH_COOKIE_NAME)?.value.trim() ?? '';
  if (existing === token) return res;

  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return res;
}

export function middleware(req: NextRequest) {
  const trace = readTraceMeta(req);
  const token = getAdminToken();

  if (!token) {
    if (process.env.NODE_ENV === 'production') {
      return withTraceHeaders(
        new NextResponse('COMPOUND_ADMIN_TOKEN or ADMIN_TOKEN must be configured.', {
          status: 503,
        }),
        trace
      );
    }
    return nextWithTrace(req, trace);
  }

  if (safeEqual(getProvidedToken(req), token)) {
    return withAuthCookie(req, nextWithTrace(req, trace), token);
  }

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return withTraceHeaders(
      NextResponse.json({ error: 'Unauthorized', requestId: trace.requestId }, { status: 401 }),
      trace
    );
  }

  return withTraceHeaders(
    new NextResponse('Authentication required.', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Compound", charset="UTF-8"',
      },
    }),
    trace
  );
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next/static|_next/image|.*\\..*).*)'],
};
