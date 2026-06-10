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

interface ClientBucket {
  key: string;
  /** Effective limit = options.limit * limitMultiplier. */
  limitMultiplier: number;
  /** Shared buckets are never cleared by rateLimitReset (one user's success
   *  must not erase the failure history of an ongoing attack). */
  shared: boolean;
}

/** Headroom for the shared fallback bucket in untrusted-proxy mode: several
 *  real clients can stay active before collateral 429s, while a spoofing
 *  attacker rotating headers is still capped at this multiple. */
const UNTRUSTED_SHARED_LIMIT_MULTIPLIER = 5;

/**
 * Only honor x-forwarded-for / x-real-ip when COMPOUND_TRUST_PROXY=true, so a
 * raw-internet-facing deployment can't be bypassed with a spoofed header.
 * Zeabur / Vercel / Cloudflare terminate TLS in front — set the flag there.
 */
function getClientBuckets(req: Request): ClientBucket[] {
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
    if (lastHop && net.isIP(lastHop)) {
      return [{ key: lastHop, limitMultiplier: 1, shared: false }];
    }
    if (realIp && net.isIP(realIp)) {
      return [{ key: realIp, limitMultiplier: 1, shared: false }];
    }
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
  // Untrusted proxy headers partition buckets so one real client behind a
  // misconfigured proxy cannot exhaust everyone's quota — but they are
  // spoofable, so a shared fallback bucket (higher cap, checked in parallel)
  // keeps header rotation from bypassing the limiter entirely.
  if (chain.length || realIp) {
    return [
      {
        key: `untrusted:${chain.join(',')}|${realIp}`.slice(0, 200),
        limitMultiplier: 1,
        shared: false,
      },
      { key: 'anon', limitMultiplier: UNTRUSTED_SHARED_LIMIT_MULTIPLIER, shared: true },
    ];
  }
  // Direct connection without any proxy headers: per-deployment constant so
  // the limiter still functions as a global throttle.
  return [{ key: 'anon', limitMultiplier: 1, shared: false }];
}

function tooManyRequests(resetAt: number, now: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return NextResponse.json(
    { error: 'Too many requests', retryAfter },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
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

  // Increment every bucket first so a denial in one bucket still records the
  // attempt in the others, then deny if ANY bucket is over its limit.
  // Use the latest resetAt across all over-limit buckets for Retry-After so
  // the client does not retry prematurely and hit a different bucket's cap.
  let anyDenied = false;
  let maxDeniedResetAt = 0;
  for (const bucket of getClientBuckets(req)) {
    const key = `${scope}:${bucket.key}`;
    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      continue;
    }
    current.count += 1;
    if (current.count > options.limit * bucket.limitMultiplier) {
      maxDeniedResetAt = Math.max(maxDeniedResetAt, current.resetAt);
      anyDenied = true;
    }
  }
  return anyDenied ? tooManyRequests(maxDeniedResetAt, now) : null;
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
  for (const bucket of getClientBuckets(req)) {
    const current = store.get(`${scope}:${bucket.key}`);
    if (!current || current.resetAt <= now) continue;
    if (current.count <= options.limit * bucket.limitMultiplier) continue;
    return tooManyRequests(current.resetAt, now);
  }
  return null;
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

  let denied: NextResponse | null = null;
  for (const bucket of getClientBuckets(req)) {
    const key = `${scope}:${bucket.key}`;
    const current = store.get(key);
    if (!current || current.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      continue;
    }
    current.count += 1;
    if (current.count > options.limit * bucket.limitMultiplier) {
      denied ??= tooManyRequests(current.resetAt, now);
    }
  }
  return denied;
}

/** Delete the rate-limit bucket for the given scope/client.
 *  Use after a successful action (e.g., correct login) to clear failure history.
 *  Shared fallback buckets are kept: one user's success must not erase the
 *  failure history of an ongoing brute-force attack. */
export function rateLimitReset(req: Request, scope: string): void {
  const store = getStore();
  for (const bucket of getClientBuckets(req)) {
    if (bucket.shared) continue;
    store.delete(`${scope}:${bucket.key}`);
  }
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
