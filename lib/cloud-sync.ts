/**
 * Cloud ↔ local sync for the browser.
 *
 * On app startup we call `/api/data/snapshot` to get the server-side SQLite
 * dump and merge it into IndexedDB. That way all browsers (desktop, phone,
 * another tab) share the same view without having to re-run the LLM pipeline.
 *
 * Strategy (simple MVP):
 *   - Server is the source of truth for anything that has a matching id.
 *   - We overwrite local rows if the server version is newer (sources by
 *     ingestedAt, concepts by updatedAt, activity by at).
 *   - We do NOT delete local rows that the server doesn't know about — that
 *     allows in-flight local ingests to survive a refresh.
 */

import { getDb } from './db';
import type { Source, Concept, ActivityLog, AskMessage } from './types';

interface SnapshotResponse {
  fetchedAt: number;
  mode?: 'full' | 'delta';
  counts: { sources: number; concepts: number; activity: number; ask: number };
  sources: Source[];
  concepts: Concept[];
  activity: ActivityLog[];
  ask: AskMessage[];
}

const LAST_PULL_KEY = 'compound:lastSnapshotPull';

export interface PullResult {
  pulledAt: number;
  applied: {
    sources: number;
    concepts: number;
    activity: number;
    ask: number;
  };
  skipped: {
    sources: number;
    concepts: number;
    activity: number;
    ask: number;
  };
}

function normalizeSnapshotTimestamp(value: number | string | null | undefined): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function buildSnapshotRequestPath(since: number | null): string {
  if (!since) return '/api/data/snapshot';
  const search = new URLSearchParams({ since: String(since) });
  return `/api/data/snapshot?${search.toString()}`;
}

export async function pullSnapshotFromCloud(): Promise<PullResult> {
  const since = getLastPullAt();
  const res = await fetch(buildSnapshotRequestPath(since), { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`snapshot failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const snap = (await res.json()) as SnapshotResponse;

  const db = getDb();
  const applied = { sources: 0, concepts: 0, activity: 0, ask: 0 };
  const skipped = { sources: 0, concepts: 0, activity: 0, ask: 0 };

  // --- sources: overwrite if server's ingestedAt is newer or equal.
  if (snap.sources.length > 0) {
    const existing = await db.sources.bulkGet(snap.sources.map((s) => s.id));
    const toPut: Source[] = [];
    for (let i = 0; i < snap.sources.length; i++) {
      const remote = snap.sources[i];
      const local = existing[i];
      if (!local || remote.ingestedAt >= local.ingestedAt) {
        toPut.push(remote);
      } else {
        skipped.sources++;
      }
    }
    if (toPut.length > 0) {
      await db.sources.bulkPut(toPut);
      applied.sources = toPut.length;
    }
  }

  // --- concepts: overwrite if server's updatedAt is newer or equal.
  if (snap.concepts.length > 0) {
    const existing = await db.concepts.bulkGet(snap.concepts.map((c) => c.id));
    const toPut: Concept[] = [];
    for (let i = 0; i < snap.concepts.length; i++) {
      const remote = snap.concepts[i];
      const local = existing[i];
      if (!local || remote.updatedAt >= local.updatedAt) {
        toPut.push(remote);
      } else {
        skipped.concepts++;
      }
    }
    if (toPut.length > 0) {
      await db.concepts.bulkPut(toPut);
      applied.concepts = toPut.length;
    }
  }

  // --- activity: merge by id (last-write wins on at).
  if (snap.activity.length > 0) {
    const existing = await db.activity.bulkGet(snap.activity.map((a) => a.id));
    const toPut: ActivityLog[] = [];
    for (let i = 0; i < snap.activity.length; i++) {
      const remote = snap.activity[i];
      const local = existing[i];
      if (!local || remote.at >= local.at) {
        toPut.push(remote);
      } else {
        skipped.activity++;
      }
    }
    if (toPut.length > 0) {
      await db.activity.bulkPut(toPut);
      applied.activity = toPut.length;
    }
  }

  // --- ask history: similar.
  if (snap.ask.length > 0) {
    const existing = await db.askHistory.bulkGet(snap.ask.map((a) => a.id));
    const toPut: AskMessage[] = [];
    for (let i = 0; i < snap.ask.length; i++) {
      const remote = snap.ask[i];
      const local = existing[i];
      if (!local || remote.at >= local.at) {
        toPut.push(remote);
      } else {
        skipped.ask++;
      }
    }
    if (toPut.length > 0) {
      await db.askHistory.bulkPut(toPut);
      applied.ask = toPut.length;
    }
  }

  try {
    localStorage.setItem(LAST_PULL_KEY, String(snap.fetchedAt));
  } catch {
    // ignore (private mode etc.)
  }

  return { pulledAt: snap.fetchedAt, applied, skipped };
}

export function getLastPullAt(): number | null {
  try {
    return normalizeSnapshotTimestamp(localStorage.getItem(LAST_PULL_KEY));
  } catch {
    return null;
  }
}
