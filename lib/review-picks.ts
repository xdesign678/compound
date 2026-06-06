import type { Concept } from './types';

const STORAGE_KEY = 'compound_review_history';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const TARGET_COUNT = 8;

interface ReviewRecord {
  id: string;
  reviewedAt: number;
}

function loadHistory(): ReviewRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: ReviewRecord[] = JSON.parse(raw);
    return parsed.filter((r) => Date.now() - r.reviewedAt < TTL_MS);
  } catch {
    return [];
  }
}

function saveHistory(records: ReviewRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // ignore quota errors
  }
}

export function markReviewed(id: string): void {
  const history = loadHistory().filter((r) => r.id !== id);
  history.push({ id, reviewedAt: Date.now() });
  saveHistory(history);
}

export function getReviewedIds(): Set<string> {
  return new Set(loadHistory().map((r) => r.id));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickReviewConcepts(concepts: Concept[]): Concept[] {
  const reviewedIds = getReviewedIds();
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const recent = concepts.filter((c) => c.updatedAt >= cutoff && !reviewedIds.has(c.id));
  const older = concepts.filter((c) => c.updatedAt < cutoff && !reviewedIds.has(c.id));

  return [...shuffle(recent), ...shuffle(older)].slice(0, TARGET_COUNT);
}

/** Lightweight unreviewed count using only concept IDs (avoids loading full objects) */
export async function getUnreviewedCountFromDb(): Promise<number> {
  const { getDb } = await import('./db');
  const allIds = await getDb().concepts.toCollection().keys();
  const reviewedIds = getReviewedIds();
  let count = 0;
  for (const id of allIds) {
    if (!reviewedIds.has(id as string)) count++;
  }
  return count;
}
