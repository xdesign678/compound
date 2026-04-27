/**
 * Shared utility helpers used across multiple server-side modules.
 *
 * Extracted from repair-worker.ts, analysis-worker.ts, sync-observability.ts
 * to eliminate duplicate definitions.
 */

/** Shorthand for Date.now() — keeps call sites concise. */
export function now(): number {
  return Date.now();
}

/**
 * Safely parse a JSON string, returning `fallback` on null/undefined/invalid input.
 */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
