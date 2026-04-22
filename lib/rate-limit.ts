import { NextResponse } from 'next/server';

type Bucket = {
  resetAt: number;
  count: number;
};

type Store = Map<string, Bucket>;

declare global {
  // eslint-disable-next-line no-var
  var __compoundRateLimitStore: Store | undefined;
}

function getStore(): Store {
  globalThis.__compoundRateLimitStore ??= new Map<string, Bucket>();
  return globalThis.__compoundRateLimitStore;
}

function getClientKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = req.headers.get('x-real-ip')?.trim();
  return forwarded || realIp || 'unknown';
}

export function rateLimit(
  req: Request,
  scope: string,
  options: { limit: number; windowMs: number }
): NextResponse | null {
  if (options.limit <= 0) return null;

  const now = Date.now();
  const store = getStore();
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
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
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
