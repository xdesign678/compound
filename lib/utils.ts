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

export function scoreCommandMatch(query: string, label: string, sublabel = ''): number {
  const q = normalizeSearchText(query);
  if (!q) return 1;
  const text = normalizeSearchText(`${label} ${sublabel}`);
  if (!text) return 0;
  if (text === q) return 1000;
  if (text.startsWith(q)) return 900 - text.length;
  const substringIndex = text.indexOf(q);
  if (substringIndex >= 0) return 760 - substringIndex;

  const sparseScore = scoreSparseMatch(q, text);
  const typoScore = scoreTypoMatch(q, text);
  return Math.max(sparseScore, typoScore);
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function scoreSparseMatch(query: string, text: string): number {
  let cursor = 0;
  let spread = 0;
  for (const char of query) {
    const index = text.indexOf(char, cursor);
    if (index < 0) return 0;
    spread += index - cursor;
    cursor = index + 1;
  }
  return Math.max(120, 520 - spread * 12 - (text.length - query.length));
}

function scoreTypoMatch(query: string, text: string): number {
  if (query.length < 3) return 0;
  const windowSize = Math.min(text.length, Math.max(query.length + 1, query.length));
  let best = Number.POSITIVE_INFINITY;
  for (let start = 0; start <= text.length - Math.min(query.length, windowSize); start += 1) {
    const candidate = text.slice(start, start + windowSize);
    best = Math.min(best, levenshteinDistance(query, candidate));
    if (best <= 1) break;
  }
  const maxDistance = Math.max(1, Math.floor(query.length / 3));
  if (best > maxDistance) return 0;
  return 300 - best * 80;
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let left = i;
    let diagonal = i - 1;
    for (let j = 1; j <= b.length; j += 1) {
      const up = previous[j] + 1;
      const insert = left + 1;
      const replace = diagonal + (a[i - 1] === b[j - 1] ? 0 : 1);
      diagonal = previous[j];
      left = Math.min(up, insert, replace);
      previous[j] = left;
    }
    previous[0] = i;
  }
  return previous[b.length];
}
