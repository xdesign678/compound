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
import { mergeRemoteConcept, mergeRemoteSource } from './snapshot-merge';
import { getAdminAuthHeaders } from './admin-auth-client';
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

interface ConceptDetailResponse {
  concepts: Concept[];
}

interface SourceDetailResponse {
  sources: Source[];
}

function normalizeSnapshotTimestamp(value: number | string | null | undefined): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

function buildSnapshotRequestPath(since: number | null): string {
  if (!since) return '/api/data/snapshot';
  const search = new URLSearchParams({ since: String(since) });
  return `/api/data/snapshot?${search.toString()}`;
}

async function fetchConceptDetails(ids: string[]): Promise<Concept[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const search = new URLSearchParams({ ids: uniqueIds.join(',') });
  const res = await fetch(`/api/data/concepts?${search.toString()}`, {
    cache: 'no-store',
    headers: getAdminAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`concept detail failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return ((await res.json()) as ConceptDetailResponse).concepts;
}

async function fetchSourceDetails(ids: string[]): Promise<Source[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const search = new URLSearchParams({ ids: uniqueIds.join(',') });
  const res = await fetch(`/api/data/sources?${search.toString()}`, {
    cache: 'no-store',
    headers: getAdminAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`source detail failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return ((await res.json()) as SourceDetailResponse).sources;
}

export async function pullSnapshotFromCloud(): Promise<PullResult> {
  const since = getLastPullAt();
  const res = await fetch(buildSnapshotRequestPath(since), {
    cache: 'no-store',
    headers: getAdminAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`snapshot failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const snap = (await res.json()) as SnapshotResponse;

  const db = getDb();
  const applied = { sources: 0, concepts: 0, activity: 0, ask: 0 };
  const skipped = { sources: 0, concepts: 0, activity: 0, ask: 0 };

  // --- sources: overwrite only if server's ingestedAt is strictly newer.
  if (snap.sources.length > 0) {
    const existing = await db.sources.bulkGet(snap.sources.map((s) => s.id));
    const toPut: Source[] = [];
    for (let i = 0; i < snap.sources.length; i++) {
      const remote = snap.sources[i];
      const local = existing[i];
      if (!local || remote.ingestedAt > local.ingestedAt) {
        toPut.push(mergeRemoteSource(local, remote));
      } else {
        skipped.sources++;
      }
    }
    if (toPut.length > 0) {
      await db.sources.bulkPut(toPut);
      applied.sources = toPut.length;
    }
  }

  // --- concepts: overwrite only if server's updatedAt is strictly newer.
  if (snap.concepts.length > 0) {
    const existing = await db.concepts.bulkGet(snap.concepts.map((c) => c.id));
    const toPut: Concept[] = [];
    for (let i = 0; i < snap.concepts.length; i++) {
      const remote = snap.concepts[i];
      const local = existing[i];
      if (!local || remote.updatedAt > local.updatedAt) {
        toPut.push(mergeRemoteConcept(local, remote));
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
      if (!local || remote.at > local.at) {
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
      if (!local || remote.at > local.at) {
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

export async function ensureConceptsHydrated(ids: string[]): Promise<Concept[]> {
  const db = getDb();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const existing = await db.concepts.bulkGet(uniqueIds);
  const missingIds = uniqueIds.filter((id, index) => {
    const concept = existing[index];
    return !concept || concept.contentStatus !== 'full' || !concept.body.trim();
  });

  if (missingIds.length > 0) {
    const concepts = await fetchConceptDetails(missingIds);
    if (concepts.length > 0) {
      await db.concepts.bulkPut(
        concepts.map((concept) => ({
          ...concept,
          contentStatus: 'full' as const,
        })),
      );
    }
  }

  const hydrated = await db.concepts.bulkGet(uniqueIds);
  return hydrated.filter((concept): concept is Concept => Boolean(concept));
}

export async function ensureConceptHydrated(id: string): Promise<Concept | null> {
  const [concept] = await ensureConceptsHydrated([id]);
  return concept ?? null;
}

export async function ensureSourcesHydrated(ids: string[]): Promise<Source[]> {
  const db = getDb();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const existing = await db.sources.bulkGet(uniqueIds);

  // Single pass: classify each source into "ready but flag-stale", "missing",
  // or "already full". We'll merge the writes into one bulkPut at the end.
  const needsFlagUpdate: Source[] = [];
  const missingIds: string[] = [];
  for (let i = 0; i < uniqueIds.length; i += 1) {
    const source = existing[i];
    if (!source || !source.rawContent.trim()) {
      missingIds.push(uniqueIds[i]);
    } else if (source.contentStatus !== 'full') {
      needsFlagUpdate.push(source);
    }
  }

  const fetched = missingIds.length > 0 ? await fetchSourceDetails(missingIds) : [];

  const toWrite: Source[] = [
    ...needsFlagUpdate.map((source) => ({ ...source, contentStatus: 'full' as const })),
    ...fetched.map((source) => ({ ...source, contentStatus: 'full' as const })),
  ];
  if (toWrite.length > 0) {
    await db.sources.bulkPut(toWrite);
  }

  const hydrated = await db.sources.bulkGet(uniqueIds);
  return hydrated.filter((source): source is Source => Boolean(source));
}

export async function ensureSourceHydrated(id: string): Promise<Source | null> {
  const [source] = await ensureSourcesHydrated([id]);
  return source ?? null;
}
