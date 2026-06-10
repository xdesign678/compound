import { NextResponse } from 'next/server';
import net from 'node:net';
import { logger } from './logging';

type Bucket = {
  resetAt: number;
  count: number;
};

type Store = Map<string, Bucket>;

declare global {
  // eslint-disable-next-line no-var
  var _compoundRateLimitStore: Store | undefined;
  // eslint-disable-next-line no-var
  var _compoundRateLimitGcAt: number | undefined;
  // eslint-disable-next-line no-var
  var _compoundRateLimitAnonWarned: boolean | undefined;
}

function getStore(): Store {
  globalThis._compoundRateLimitStore ??= new Map<string, Bucket>();
  return globalThis._compoundRateLimitStore;
}

/** Max entries retained. When exceeded we sweep expired buckets aggressively. */
const MAX_ENTRIES = 5_000;
/** Minimum interval between background sweeps. */
const GC_MIN_INTERVAL_MS = 30_000;

function maybeGc(store: Store, now: number): void {
  const lastGc = globalThis._compoundRateLimitGcAt ?? 0;
  if (store.size < MAX_ENTRIES && now - lastGc < GC_MIN_INTERVAL_MS) return;
  globalThis._compoundRateLimitGcAt = now;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
  // Still oversized? Drop oldest-reset entries until under limit.
  if (store.size > MAX_ENTRIES) {
    const sorted = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const overflow = store.size - MAX_ENTRIES;
    for (let i = 0; i < overflow; i++) store.delete(sorted[i][0]);
  }
}

/**
 * Only honor x-forwarded-for / x-real-ip when COMPOUND_TRUST_PROXY=true, so a
 * raw-internet-facing deployment can't be bypassed with a spoofed header.
 * Zeabur / Vercel / Cloudflare terminate TLS in front — set the flag there.
 */
function getClientKey(req: Request): string {
  const trustProxy = process.env.COMPOUND_TRUST_PROXY === 'true';
  const chain = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const realIp = req.headers.get('x-real-ip')?.trim() ?? '';
  if (trustProxy) {
    // The trusted proxy in front of us APPENDS the real client IP, so only
    // the last entry is trustworthy — earlier entries arrive straight from
    // the client and are spoofable (would allow rate-limit evasion).
    const lastHop = chain[chain.length - 1];
    if (lastHop && net.isIP(lastHop)) return lastHop;
    if (realIp && net.isIP(realIp)) return realIp;
  }
  // WARNING: Without COMPOUND_TRUST_PROXY=true there is no trustworthy client
  // identity. Set COMPOUND_TRUST_PROXY=true when running behind a trusted
  // reverse proxy (Zeabur, Vercel, Cloudflare, etc.).
  //
  // In production this is escalated to ERROR-level so the misconfig surfaces
  // on Sentry / log aggregators — `instrumentation.ts` also prints a loud
  // startup warning.
  if (!globalThis._compoundRateLimitAnonWarned) {
    globalThis._compoundRateLimitAnonWarned = true;
    const context = {
      bucket: 'anon',
      recommendation: 'Set COMPOUND_TRUST_PROXY=true behind a trusted reverse proxy.',
    };
    if (process.env.NODE_ENV === 'production') {
      logger.error('rate_limit.trust_proxy_disabled_in_production', context);
    } else {
      logger.warn('rate_limit.trust_proxy_disabled', context);
    }
  }
  // Untrusted proxy headers still partition buckets: behind a misconfigured
  // proxy each real client keeps its own quota instead of one shared 'anon'
  // bucket that a single aggressive client could exhaust for everyone.
  // Spoofed values only isolate the spoofer; the store stays bounded via
  // MAX_ENTRIES.
  if (chain.length || realIp) {
    return `untrusted:${chain.join(',')}|${realIp}`.slice(0, 200);
  }
  // Direct connection without any proxy headers: per-deployment constant so
  // the limiter still functions as a global throttle.
  return 'anon';
}

export function rateLimit(
  req: Request,
  scope: string,
  options: { limit: number; windowMs: number },
): NextResponse | null {
  if (options.limit <= 0) return null;

  const now = Date.now();
  const store = getStore();
  maybeGc(store, now);
  const key = `${scope}:${getClientKey(req)}`;
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  current.count += 1;
  if (current.count <= options.limit) return null;

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'Too many requests', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

export function llmRateLimit(req: Request): NextResponse | null {
  const limit = Number(process.env.COMPOUND_LLM_RATE_LIMIT_PER_MINUTE ?? 20);
  return rateLimit(req, 'llm', { limit, windowMs: 60_000 });
}

export function syncRateLimit(req: Request): NextResponse | null {
  const limit = Number(process.env.COMPOUND_SYNC_RATE_LIMIT_PER_MINUTE ?? 10);
  return rateLimit(req, 'sync', { limit, windowMs: 60_000 });
}

// ─── Split check / increment / reset for failure-only scopes (auth) ─────

/** Read-only check: is the client currently over the rate limit?
 *  Does NOT increment the counter — safe to call before expensive work. */
export function rateLimitCheck(
  req: Request,
  scope: string,
  options: { limit: number; windowMs: number },
): NextResponse | null {
  if (options.limit <= 0) return null;

  const now = Date.now();
  const store = getStore();
  const key = `${scope}:${getClientKey(req)}`;
  const current = store.get(key);

  if (!current || current.resetAt <= now) return null;
  if (current.count <= options.limit) return null;

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'Too many requests', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

/** Increment the counter for the given scope/client.
 *  Returns 429 if the count now exceeds the limit.
 *  Use after confirming a failure (e.g., wrong token) so only failures are counted. */
export function rateLimitIncrement(
  req: Request,
  scope: string,
  options: { limit: number; windowMs: number },
): NextResponse | null {
  if (options.limit <= 0) return null;

  const now = Date.now();
  const store = getStore();
  maybeGc(store, now);
  const key = `${scope}:${getClientKey(req)}`;
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  current.count += 1;
  if (current.count <= options.limit) return null;

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'Too many requests', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}

/** Delete the rate-limit bucket for the given scope/client.
 *  Use after a successful action (e.g., correct login) to clear failure history. */
export function rateLimitReset(req: Request, scope: string): void {
  const store = getStore();
  const key = `${scope}:${getClientKey(req)}`;
  store.delete(key);
}

// ─── Auth brute-force protection (counts only failed attempts) ──────────

const AUTH_RATE_LIMIT_PER_MINUTE = Number(process.env.COMPOUND_AUTH_RATE_LIMIT ?? 20);

/** Pre-check: is this client currently auth-rate-limited? Does NOT increment. */
export function authRateLimitCheck(req: Request): NextResponse | null {
  return rateLimitCheck(req, 'auth', { limit: AUTH_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });
}

/** Record a failed auth attempt. Returns 429 if now over limit. */
export function authRateLimitFail(req: Request): NextResponse | null {
  return rateLimitIncrement(req, 'auth', { limit: AUTH_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });
}

/** Reset auth failure counter after successful authentication. */
export function authRateLimitReset(req: Request): void {
  rateLimitReset(req, 'auth');
}

// ─── Webhook IP rate limiting (counts all requests, before HMAC) ────────

const WEBHOOK_RATE_LIMIT_PER_MINUTE = Number(process.env.COMPOUND_WEBHOOK_RATE_LIMIT ?? 60);

/** Webhook rate limit — counts every request (not just failures). Apply before HMAC. */
export function webhookRateLimit(req: Request): NextResponse | null {
  return rateLimit(req, 'webhook', { limit: WEBHOOK_RATE_LIMIT_PER_MINUTE, windowMs: 60_000 });
}
