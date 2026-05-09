export interface RateLimitBackoffOptions {
  nowMs?: number;
  remainingThreshold?: number;
  defaultBackoffMs?: number;
  maxBackoffMs?: number;
}

function clampBackoff(ms: number, maxBackoffMs: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(Math.ceil(ms), maxBackoffMs);
}

function parseRetryAfter(value: string | null, nowMs: number, maxBackoffMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return clampBackoff(seconds * 1000, maxBackoffMs);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return clampBackoff(dateMs - nowMs, maxBackoffMs);
  return null;
}

function parseResetBackoff(
  value: string | null,
  nowMs: number,
  maxBackoffMs: number,
): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const resetMs = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
  return clampBackoff(resetMs - nowMs, maxBackoffMs);
}

export function parseRateLimitBackoffMs(
  headers: Headers,
  options: RateLimitBackoffOptions = {},
): number | null {
  const nowMs = options.nowMs ?? Date.now();
  const maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
  const retryAfter = parseRetryAfter(headers.get('retry-after'), nowMs, maxBackoffMs);
  if (retryAfter != null) return retryAfter;

  const rawRemaining = headers.get('x-ratelimit-remaining');
  if (rawRemaining == null || rawRemaining.trim() === '') return null;
  const remaining = Number(rawRemaining);
  const threshold = options.remainingThreshold ?? 1;
  if (!Number.isFinite(remaining) || remaining >= threshold) return null;

  return (
    parseResetBackoff(headers.get('x-ratelimit-reset'), nowMs, maxBackoffMs) ??
    clampBackoff(options.defaultBackoffMs ?? 30_000, maxBackoffMs)
  );
}
