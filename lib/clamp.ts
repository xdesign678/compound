/**
 * Input sanitisation helpers for numeric query / body parameters.
 *
 * Prevents NaN from flowing into SQL or business logic by providing a
 * deterministic parse-and-clamp pipeline: invalid → undefined (caller
 * decides 400 vs safe-default), valid → clamped integer within [min, max].
 *
 * Server-only (imported from `app/api/**` routes), but has no Node.js
 * deps so it could be shared if needed.
 */

/** Maximum concept / chunk limit for wiki/search (VAL-API-014). */
export const MAX_CONCEPT_LIMIT = 100;
/** Maximum chunk limit for wiki/search. */
export const MAX_CHUNK_LIMIT = 50;
/** Maximum topic limit for wiki/topics. */
export const MAX_TOPIC_LIMIT = 200;
/** Maximum days window for ops/model-runs. */
export const MAX_DAYS = 90;

/**
 * Parse a value into a positive integer, returning `undefined` when the
 * input is not a valid finite number (NaN, Infinity, non-numeric string, etc.).
 *
 * When valid, the result is clamped to `[1, max]`.
 *
 * This is intentionally strict: `"3"` parses, but `"3.5"` / `"abc"` / `null`
 * / `undefined` all return `undefined` so the caller can respond with 400.
 */
export function parsePositiveInt(value: unknown, max: number): number | undefined {
  // Coerce string → number first (query params are always strings)
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;

  if (!Number.isFinite(n)) return undefined;

  const int = Math.trunc(n);
  if (int !== n) return undefined; // reject non-integers like 3.5

  if (int < 1) return undefined; // reject zero / negative

  return Math.min(int, max);
}

/**
 * Convenience alias for `parsePositiveInt`. The name emphasises the *clamping*
 * semantics (large but valid integers are silently clamped, only truly
 * non-numeric / non-integer / non-positive inputs are rejected as `undefined`).
 *
 * Prefer `clampLimit` at call-sites where the caller responds with 400 for
 * malformed input and clamps out-of-range input (e.g. API query params).
 * Prefer `parsePositiveInt` at call-sites where the "parse" semantics are
 * clearer (e.g. internal logic that just needs a safe integer).
 */
export function clampLimit(value: unknown, max: number): number | undefined {
  return parsePositiveInt(value, max);
}
