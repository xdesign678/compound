import { NextResponse } from 'next/server';
import net from 'node:net';

type Bucket = {
  resetAt: number;
  count: number;
};

type Store = Map<string, Bucket>;

declare global {
  // eslint-disable-next-line no-var
  var __compoundRateLimitStore: Store | undefined;
  // eslint-disable-next-line no-var
  var __compoundRateLimitGcAt: number | undefined;
  // eslint-disable-next-line no-var
  var __compoundRateLimitAnonWarned: boolean | undefined;
}

function getStore(): Store {
  globalThis.__compoundRateLimitStore ??= new Map<string, Bucket>();
  return globalThis.__compoundRateLimitStore;
}

/** Max entries retained. When exceeded we sweep expired buckets aggressively. */
const MAX_ENTRIES = 5_000;
/** Minimum interval between background sweeps. */
const GC_MIN_INTERVAL_MS = 30_000;

function maybeGc(store: Store, now: number): void {
  const lastGc = globalThis.__compoundRateLimitGcAt ?? 0;
  if (store.size < MAX_ENTRIES && now - lastGc < GC_MIN_INTERVAL_MS) return;
  globalThis.__compoundRateLimitGcAt = now;
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
  if (trustProxy) {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded && net.isIP(forwarded)) return forwarded;
    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp && net.isIP(realIp)) return realIp;
  }
  // Fall back to a per-deployment constant so the limiter still functions as
  // a global throttle even without IP attribution.
  // WARNING: Without COMPOUND_TRUST_PROXY=true, ALL users share the same
  // rate-limit bucket ('anon'), meaning a single aggressive client can
  // exhaust the quota for everyone. Set COMPOUND_TRUST_PROXY=true when
  // running behind a trusted reverse proxy (Vercel, Cloudflare, etc.).
  if (!globalThis.__compoundRateLimitAnonWarned) {
    globalThis.__compoundRateLimitAnonWarned = true;
    console.warn(
      '[compound/rate-limit] COMPOUND_TRUST_PROXY is not set to "true". ' +
        'All requests share a single rate-limit bucket ("anon"). ' +
        'Set COMPOUND_TRUST_PROXY=true behind a trusted reverse proxy to enable per-IP limiting.',
    );
  }
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
