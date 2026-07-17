/**
 * Cloud ↔ local sync for the browser.
 *
 * On app startup we call `/api/data/snapshot` to get the server-side SQLite
 * dump and merge it into IndexedDB. That way all browsers (desktop, phone,
 * another tab) share the same view without having to re-run the LLM pipeline.
 *
 * Strategy:
 *   - The server exposes a monotonic SQLite change cursor.
 *   - Full pulls reconcile the complete source/concept id set.
 *   - Delta pulls apply ordered upserts and tombstones, so edits and deletes
 *     converge across browsers without relying on wall-clock timestamps.
 */

import { getDb } from './db';
import { mergeRemoteConcept, mergeRemoteSource } from './snapshot-merge';
import { getAdminAuthHeaders } from './admin-auth-client';
import { withRequestId } from './trace-client';
import type { Source, Concept, ActivityLog, AskMessage } from './types';

interface SnapshotResponse {
  fetchedAt: number;
  mode?: 'full' | 'delta';
  pagination?: {
    limit: number;
    offset: number;
    totalSources: number;
    totalConcepts: number;
  };
  counts: { sources: number; concepts: number; activity: number; ask: number };
  sources: Source[];
  concepts: Concept[];
  activity: ActivityLog[];
  ask: AskMessage[];
  sync: {
    cursor: number;
    upperCursor: number;
    hasMore: boolean;
    deleted: {
      sources: string[];
      concepts: string[];
      activity: string[];
      ask: string[];
    };
  };
}

const LAST_SYNC_CURSOR_KEY = 'compound:lastSyncCursor';
const SNAPSHOT_PAGE_SIZE = 1000;
export const OFFLINE_WRITE_MAX_BYTES = 256 * 1024;

export function getOfflineWritePayloadBytes(payload: unknown): number {
  const serialized = JSON.stringify(payload) ?? '';
  if (typeof Blob === 'undefined') return serialized.length;
  return new Blob([serialized]).size;
}

export function canQueueOfflineWrite(payload: unknown): boolean {
  return getOfflineWritePayloadBytes(payload) <= OFFLINE_WRITE_MAX_BYTES;
}

/** In-flight deduplication for pullSnapshotFromCloud */
let syncInFlight: Promise<PullResult> | null = null;

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

function normalizeSyncCursor(value: number | string | null | undefined): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function buildSnapshotRequestPath(input: {
  cursor: number | null;
  beforeCursor?: number | null;
  limit?: number;
  offset?: number;
}): string {
  const search = new URLSearchParams();
  if (input.cursor !== null) search.set('cursor', String(input.cursor));
  if (input.beforeCursor !== null && input.beforeCursor !== undefined) {
    search.set('beforeCursor', String(input.beforeCursor));
  }
  if (typeof input.limit === 'number') search.set('limit', String(input.limit));
  if (typeof input.offset === 'number') search.set('offset', String(input.offset));
  const query = search.toString();
  if (!query) return '/api/data/snapshot';
  return `/api/data/snapshot?${search.toString()}`;
}

function buildSameOriginRequestUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  return new URL(path, window.location.origin).toString();
}

async function fetchConceptDetails(ids: string[]): Promise<Concept[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const search = new URLSearchParams({ ids: uniqueIds.join(',') });
  const res = await fetch(buildSameOriginRequestUrl(`/api/data/concepts?${search.toString()}`), {
    cache: 'no-store',
    headers: withRequestId(getAdminAuthHeaders()),
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
  const res = await fetch(buildSameOriginRequestUrl(`/api/data/sources?${search.toString()}`), {
    cache: 'no-store',
    headers: withRequestId(getAdminAuthHeaders()),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`source detail failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return ((await res.json()) as SourceDetailResponse).sources;
}

export async function pullSnapshotFromCloud(): Promise<PullResult> {
  // In-flight deduplication: if a sync is already running, return that promise
  if (syncInFlight) return syncInFlight;
  syncInFlight = pullSnapshotFromCloudInner();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function pullSnapshotFromCloudInner(): Promise<PullResult> {
  const initialCursor = getLastSyncCursor();
  let fullReconciliation = initialCursor === null;
  const db = getDb();
  const applied = { sources: 0, concepts: 0, activity: 0, ask: 0 };
  const skipped = { sources: 0, concepts: 0, activity: 0, ask: 0 };
  let pulledAt = Date.now();
  let requestCursor = initialCursor;
  let upperCursor: number | null = null;
  let offset = 0;
  const fullSourceIds = new Set<string>();
  const fullConceptIds = new Set<string>();

  while (true) {
    const res = await fetch(
      buildSameOriginRequestUrl(
        buildSnapshotRequestPath({
          cursor: requestCursor,
          beforeCursor: upperCursor,
          limit: SNAPSHOT_PAGE_SIZE,
          offset,
        }),
      ),
      {
        cache: 'no-store',
        headers: withRequestId(getAdminAuthHeaders()),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`snapshot failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const snap = (await res.json()) as SnapshotResponse;
    if (snap.mode === 'full') fullReconciliation = true;
    upperCursor ??= snap.sync.upperCursor;
    pulledAt = snap.fetchedAt;

    if (snap.sync.deleted.sources.length > 0) {
      await db.sources.bulkDelete(snap.sync.deleted.sources);
      applied.sources += snap.sync.deleted.sources.length;
    }
    if (snap.sync.deleted.concepts.length > 0) {
      await db.concepts.bulkDelete(snap.sync.deleted.concepts);
      applied.concepts += snap.sync.deleted.concepts.length;
    }
    if (snap.sync.deleted.activity.length > 0) {
      await db.activity.bulkDelete(snap.sync.deleted.activity);
      applied.activity += snap.sync.deleted.activity.length;
    }
    if (snap.sync.deleted.ask.length > 0) {
      await db.askHistory.bulkDelete(snap.sync.deleted.ask);
      applied.ask += snap.sync.deleted.ask.length;
    }

    if (fullReconciliation) {
      for (const source of snap.sources) fullSourceIds.add(source.id);
      for (const concept of snap.concepts) fullConceptIds.add(concept.id);
    }

    // --- sources: merge by the explicit mutation revision.
    if (snap.sources.length > 0) {
      const existing = await db.sources.bulkGet(snap.sources.map((s) => s.id));
      const toPut: Source[] = [];
      for (let i = 0; i < snap.sources.length; i++) {
        const remote = snap.sources[i];
        const local = existing[i];
        const remoteRevision = remote.updatedAt ?? remote.ingestedAt;
        const localRevision = local ? (local.updatedAt ?? local.ingestedAt) : -1;
        if (!local || remoteRevision >= localRevision) {
          toPut.push(mergeRemoteSource(local, remote));
        } else {
          skipped.sources++;
        }
      }
      if (toPut.length > 0) {
        await db.sources.bulkPut(toPut);
        applied.sources += toPut.length;
      }
    }

    // --- concepts: overwrite when the server revision is equal or newer.
    if (snap.concepts.length > 0) {
      const existing = await db.concepts.bulkGet(snap.concepts.map((c) => c.id));
      const toPut: Concept[] = [];
      for (let i = 0; i < snap.concepts.length; i++) {
        const remote = snap.concepts[i];
        const local = existing[i];
        if (!local || remote.updatedAt >= local.updatedAt) {
          toPut.push(mergeRemoteConcept(local, remote));
        } else {
          skipped.concepts++;
        }
      }
      if (toPut.length > 0) {
        await db.concepts.bulkPut(toPut);
        applied.concepts += toPut.length;
      }
    }

    // --- activity: merge by id (last-write wins on at).
    if (offset === 0 && snap.activity.length > 0) {
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
        applied.activity += toPut.length;
      }
    }

    // --- ask history: similar.
    if (offset === 0 && snap.ask.length > 0) {
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
        applied.ask += toPut.length;
      }
    }

    if (snap.mode === 'delta') {
      requestCursor = snap.sync.cursor;
      if (!snap.sync.hasMore) break;
      continue;
    }

    const pagination = snap.pagination;
    if (!pagination) break;
    const nextOffset = pagination.offset + pagination.limit;
    const totalRecords = Math.max(pagination.totalSources, pagination.totalConcepts);
    if (nextOffset >= totalRecords) break;
    offset = nextOffset;
  }

  if (fullReconciliation) {
    const [localSourceIds, localConceptIds] = await Promise.all([
      db.sources.toCollection().primaryKeys(),
      db.concepts.toCollection().primaryKeys(),
    ]);
    const staleSourceIds = localSourceIds.filter((id) => !fullSourceIds.has(String(id)));
    const staleConceptIds = localConceptIds.filter((id) => !fullConceptIds.has(String(id)));
    if (staleSourceIds.length > 0) {
      await db.sources.bulkDelete(staleSourceIds.map(String));
      applied.sources += staleSourceIds.length;
    }
    if (staleConceptIds.length > 0) {
      await db.concepts.bulkDelete(staleConceptIds.map(String));
      applied.concepts += staleConceptIds.length;
    }
  }

  try {
    if (upperCursor !== null) localStorage.setItem(LAST_SYNC_CURSOR_KEY, String(upperCursor));
  } catch {
    // ignore (private mode etc.)
  }

  return { pulledAt, applied, skipped };
}

export function getLastSyncCursor(): number | null {
  try {
    return normalizeSyncCursor(localStorage.getItem(LAST_SYNC_CURSOR_KEY));
  } catch {
    return null;
  }
}

export async function ensureConceptsHydrated(ids: string[]): Promise<Concept[]> {
  const db = getDb();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const existing = await db.concepts.bulkGet(uniqueIds);
  const missingIds = uniqueIds.filter((_id, index) => {
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
