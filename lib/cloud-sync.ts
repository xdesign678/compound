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
 *   - Dexie `syncMeta` is the single source of truth for cursor/identity/
 *     quarantine. Legacy localStorage keys are migrated once.
 */

import { getDb, type CompoundDB } from './db';
import { mergeRemoteConcept, mergeRemoteSource } from './snapshot-merge';
import { getAdminAuthHeaders } from './admin-auth-client';
import { withRequestId } from './trace-client';
import type { SyncMetaRecord } from './offline-outbox';
import type { Source, Concept, ActivityLog, AskMessage } from './types';
import {
  DESTRUCTIVE_RECONCILE_BLOCKED,
  LAST_SYNC_CURSOR_KEY,
  SYNC_META_KEY,
  SYNC_QUARANTINE_KEY,
  buildQuarantineRecord,
  hasCompleteIdentity,
  planDeltaTrust,
  isAuthoritativeEmptySnapshot,
  planFullReconciliation,
  readDatasetIdentity,
  readFourTableTotals,
  readSyncQuarantine,
  resolveDestructiveDeletes,
  validateFullSnapshotPayload,
  validateSnapshotEnvelope,
  type DatasetIdentity,
  type ReconcileMode,
  type ReconcileReason,
  type SyncQuarantine,
} from './sync-reconciliation';

interface SnapshotResponse {
  fetchedAt: number;
  mode?: 'full' | 'delta';
  pagination?: {
    limit: number;
    offset: number;
    totalSources: number;
    totalConcepts: number;
    totalActivity?: number;
    totalAsk?: number;
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
  dataset?: DatasetIdentity | null;
}

const SNAPSHOT_PAGE_SIZE = 1000;
const MAX_SNAPSHOT_PAGES = 200;
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
  authoritativeEmpty: boolean;
  reconcileMode: ReconcileMode;
  destructiveReconcileBlocked: boolean;
  quarantine: SyncQuarantine | null;
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

interface SyncStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export function normalizeSyncCursor(value: number | string | null | undefined): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
}

function emptySyncMeta(): SyncMetaRecord {
  return { id: 'current' };
}

function identityFromMeta(meta: SyncMetaRecord | null | undefined): DatasetIdentity | null {
  if (!meta) return null;
  if (!meta.datasetId && meta.generation == null) return null;
  return {
    datasetId: meta.datasetId ?? null,
    generation: meta.generation ?? null,
  };
}

export interface SyncMetaStore {
  get(id: 'current' | string): Promise<SyncMetaRecord | undefined>;
  put(record: SyncMetaRecord): Promise<unknown>;
}

export async function migrateLegacySyncMeta(
  database: { syncMeta: SyncMetaStore },
  storage: SyncStorage,
): Promise<SyncMetaRecord> {
  const existing = await database.syncMeta.get('current');
  const hasDexieFact =
    existing &&
    (existing.cursor != null ||
      Boolean(existing.datasetId) ||
      existing.generation != null ||
      Boolean(existing.quarantine));
  if (hasDexieFact && existing) return existing;

  const cursor = normalizeSyncCursor(storage.getItem(LAST_SYNC_CURSOR_KEY));
  const identity = readDatasetIdentity(storage.getItem(SYNC_META_KEY));
  const quarantine = readSyncQuarantine(storage.getItem(SYNC_QUARANTINE_KEY));
  const migrated: SyncMetaRecord = {
    id: 'current',
    cursor: cursor ?? existing?.cursor ?? undefined,
    datasetId: identity?.datasetId ?? existing?.datasetId ?? undefined,
    generation: identity?.generation ?? identity?.epoch ?? existing?.generation ?? undefined,
    quarantine: quarantine ?? existing?.quarantine ?? undefined,
  };
  await database.syncMeta.put(migrated);
  try {
    storage.removeItem(LAST_SYNC_CURSOR_KEY);
    storage.removeItem(SYNC_META_KEY);
    storage.removeItem(SYNC_QUARANTINE_KEY);
  } catch {
    // ignore (private mode)
  }
  return migrated;
}

export async function persistSyncMetaRecord(
  database: { syncMeta: SyncMetaStore },
  record: SyncMetaRecord,
): Promise<void> {
  await database.syncMeta.put({ ...record, id: 'current' });
}

async function loadSyncMeta(database: CompoundDB = getDb()): Promise<SyncMetaRecord> {
  if (typeof window === 'undefined') return emptySyncMeta();
  try {
    return await migrateLegacySyncMeta(database, window.localStorage);
  } catch {
    return (await database.syncMeta.get('current')) ?? emptySyncMeta();
  }
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
  if (syncInFlight) return syncInFlight;
  syncInFlight = pullSnapshotFromCloudGuarded();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

async function pullSnapshotFromCloudGuarded(): Promise<PullResult> {
  const db = getDb();
  const meta = await loadSyncMeta(db);
  const initialCursor = normalizeSyncCursor(meta.cursor ?? null);
  const first = await pullSnapshotPass({
    db,
    meta,
    requestCursor: initialCursor,
    forceFull: initialCursor === null,
  });
  return first.result;
}

interface PullPassResult {
  result: PullResult;
}

async function fetchSnapshotPage(input: {
  cursor: number | null;
  beforeCursor: number | null;
  offset: number;
}): Promise<SnapshotResponse> {
  const res = await fetch(
    buildSameOriginRequestUrl(
      buildSnapshotRequestPath({
        cursor: input.cursor,
        beforeCursor: input.beforeCursor,
        limit: SNAPSHOT_PAGE_SIZE,
        offset: input.offset,
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
  return (await res.json()) as SnapshotResponse;
}

async function fetchAllSnapshotPages(input: {
  requestCursor: number | null;
  forceFull: boolean;
}): Promise<{ pages: SnapshotResponse[]; truncated: boolean }> {
  const pages: SnapshotResponse[] = [];
  let requestCursor = input.forceFull ? null : input.requestCursor;
  let upperCursor: number | null = null;
  let offset = 0;
  let truncated = false;
  for (let pageIndex = 0; pageIndex < MAX_SNAPSHOT_PAGES; pageIndex += 1) {
    const snap = await fetchSnapshotPage({
      cursor: requestCursor,
      beforeCursor: upperCursor,
      offset,
    });
    pages.push(snap);
    upperCursor ??= snap.sync.upperCursor;
    if (snap.mode === 'delta' && !input.forceFull) {
      if (!snap.sync.hasMore) break;
      requestCursor = snap.sync.cursor;
      if (pageIndex === MAX_SNAPSHOT_PAGES - 1) truncated = true;
      continue;
    }
    const pagination = snap.pagination;
    const totals = readFourTableTotals(pagination);
    if (!pagination || !totals) break;
    const nextOffset = pagination.offset + pagination.limit;
    const totalRecords = Math.max(
      totals.totalSources,
      totals.totalConcepts,
      totals.totalActivity,
      totals.totalAsk,
    );
    if (nextOffset >= totalRecords && !snap.sync.hasMore) break;
    if (pageIndex === MAX_SNAPSHOT_PAGES - 1 && (snap.sync.hasMore || nextOffset < totalRecords)) {
      truncated = true;
      break;
    }
    offset = nextOffset;
  }
  return { pages, truncated };
}

export async function validateAndApplySnapshotPages(input: {
  db: CompoundDB;
  meta: SyncMetaRecord;
  pages: SnapshotResponse[];
  forceFull: boolean;
  truncated?: boolean;
}): Promise<PullPassResult> {
  const { db, meta, pages } = input;
  const initialCursor = normalizeSyncCursor(meta.cursor ?? null);
  const localIdentity = identityFromMeta(meta);
  const pulledAt = pages[pages.length - 1]?.fetchedAt ?? Date.now();
  const envelope = validateSnapshotEnvelope(pages, {
    truncated: input.truncated,
    initialCursor,
  });
  if (!envelope.ok) {
    return persistQuarantineWithoutKnowledgeWrites({
      db,
      meta,
      pulledAt,
      initialCursor,
      remoteCursor: pages[0]?.sync?.upperCursor ?? null,
      reason: 'envelope_mismatch',
    });
  }

  const remoteIdentity = envelope.identity;
  const upperCursor = envelope.upperCursor;
  const fullReconciliation = input.forceFull || envelope.mode === 'full';

  if (fullReconciliation) {
    const payload = validateFullSnapshotPayload(pages);
    if (payload.ok === false) {
      return persistQuarantineWithoutKnowledgeWrites({
        db,
        meta,
        pulledAt,
        initialCursor,
        remoteCursor: upperCursor,
        reason: payload.reason,
      });
    }
  }

  if (!fullReconciliation && envelope.mode === 'delta') {
    const deltaTrust = planDeltaTrust({
      localIdentity,
      remoteIdentity,
      initialCursor,
      remoteUpperCursor: upperCursor,
    });
    if (!deltaTrust.allowTombstones) {
      return persistQuarantineWithoutKnowledgeWrites({
        db,
        meta,
        pulledAt,
        initialCursor,
        remoteCursor: upperCursor,
        reason: deltaTrust.reason,
      });
    }
    return applyTrustedPages({
      db,
      meta,
      pages,
      initialCursor,
      remoteIdentity,
      upperCursor,
      fullReconciliation: false,
      allowTombstones: true,
      pulledAt,
    });
  }

  return applyTrustedPages({
    db,
    meta,
    pages,
    initialCursor,
    remoteIdentity,
    upperCursor,
    fullReconciliation: true,
    allowTombstones: false,
    pulledAt,
  });
}

async function persistQuarantineWithoutKnowledgeWrites(input: {
  db: CompoundDB;
  meta: SyncMetaRecord;
  pulledAt: number;
  initialCursor: number | null;
  remoteCursor: number | null;
  reason: ReconcileReason;
}): Promise<PullPassResult> {
  const quarantine = buildQuarantineRecord({
    at: input.pulledAt,
    reason: input.reason,
    staleSourceIds: [],
    staleConceptIds: [],
    localCursor: input.initialCursor,
    remoteCursor: input.remoteCursor,
  });
  const nextMeta: SyncMetaRecord = {
    ...input.meta,
    id: 'current',
    quarantine,
  };
  await persistSyncMetaRecord(input.db, nextMeta);
  return {
    result: {
      pulledAt: input.pulledAt,
      authoritativeEmpty: false,
      reconcileMode: 'isolated',
      destructiveReconcileBlocked: true,
      quarantine,
      applied: { sources: 0, concepts: 0, activity: 0, ask: 0 },
      skipped: { sources: 0, concepts: 0, activity: 0, ask: 0 },
    },
  };
}

async function applyTrustedPages(input: {
  db: CompoundDB;
  meta: SyncMetaRecord;
  pages: SnapshotResponse[];
  initialCursor: number | null;
  remoteIdentity: DatasetIdentity;
  upperCursor: number;
  fullReconciliation: boolean;
  allowTombstones: boolean;
  pulledAt: number;
}): Promise<PullPassResult> {
  const { db, meta, pages } = input;
  const applied = { sources: 0, concepts: 0, activity: 0, ask: 0 };
  const skipped = { sources: 0, concepts: 0, activity: 0, ask: 0 };
  const fullSourceIds = new Set<string>();
  const fullConceptIds = new Set<string>();
  const fullActivityIds = new Set<string>();
  const fullAskIds = new Set<string>();
  const first = pages[0];
  const authoritativeEmpty = Boolean(
    input.fullReconciliation && isAuthoritativeEmptySnapshot(readFourTableTotals(first.pagination)),
  );

  const tables = [db.sources, db.concepts, db.activity, db.askHistory, db.syncMeta];
  let reconcileMode: ReconcileMode = input.fullReconciliation ? 'destructive_full' : 'delta';
  let destructiveReconcileBlocked = false;
  let quarantine: SyncQuarantine | null = null;

  await db.transaction('rw', tables, async () => {
    const [localSourceIds, localConceptIds, localActivityIds, localAskIds] = await Promise.all([
      db.sources.toCollection().primaryKeys(),
      db.concepts.toCollection().primaryKeys(),
      db.activity.toCollection().primaryKeys(),
      db.askHistory.toCollection().primaryKeys(),
    ]);

    for (const snap of pages) {
      for (const source of snap.sources) fullSourceIds.add(source.id);
      for (const concept of snap.concepts) fullConceptIds.add(concept.id);
      for (const activity of snap.activity) fullActivityIds.add(activity.id);
      for (const ask of snap.ask) fullAskIds.add(ask.id);
    }

    const nextMeta: SyncMetaRecord = { ...meta, id: 'current' };
    let allowKnowledgeWrites = !input.fullReconciliation;
    let allowAdvanceCursor = input.allowTombstones && !input.fullReconciliation;
    let sourceIdsToDelete: string[] = [];
    let conceptIdsToDelete: string[] = [];

    if (input.fullReconciliation) {
      const plan = planFullReconciliation({
        hadLocalCursor: input.initialCursor !== null,
        hadLocalBinding: Boolean(meta.datasetId) || input.initialCursor !== null,
        localIdentity: identityFromMeta(meta),
        remoteIdentity: input.remoteIdentity,
        localSourceIds,
        localConceptIds,
        remoteSourceIds: fullSourceIds,
        remoteConceptIds: fullConceptIds,
        localActivityIds,
        localAskIds,
        remoteActivityIds: fullActivityIds,
        remoteAskIds: fullAskIds,
        initialCursor: input.initialCursor,
        remoteUpperCursor: input.upperCursor,
      });
      const deletes = resolveDestructiveDeletes(plan);
      reconcileMode = plan.allowDestructiveDelete ? 'destructive_full' : 'isolated';
      allowAdvanceCursor = plan.allowAdvanceCursor;
      allowKnowledgeWrites = plan.allowAdvanceCursor;
      sourceIdsToDelete = deletes.sourceIdsToDelete;
      conceptIdsToDelete = deletes.conceptIdsToDelete;
      if (!plan.allowAdvanceCursor) {
        destructiveReconcileBlocked = true;
        quarantine = buildQuarantineRecord({
          at: input.pulledAt,
          reason: plan.reason,
          staleSourceIds: plan.staleSourceIds,
          staleConceptIds: plan.staleConceptIds,
          staleActivityIds: plan.staleActivityIds,
          staleAskIds: plan.staleAskIds,
          localCursor: input.initialCursor,
          remoteCursor: input.upperCursor,
        });
        nextMeta.quarantine = quarantine;
        console.warn('[cloud-sync] ' + DESTRUCTIVE_RECONCILE_BLOCKED, {
          reason: plan.reason,
          staleSourceCount: quarantine.staleSourceCount,
          staleConceptCount: quarantine.staleConceptCount,
          staleActivityCount: quarantine.staleActivityCount,
          staleAskCount: quarantine.staleAskCount,
        });
        await persistSyncMetaRecord(db, nextMeta);
        return;
      }
      nextMeta.quarantine = undefined;
      if (plan.allowBindIdentity && hasCompleteIdentity(input.remoteIdentity)) {
        nextMeta.datasetId = input.remoteIdentity.datasetId ?? undefined;
        nextMeta.generation =
          input.remoteIdentity.generation ?? input.remoteIdentity.epoch ?? undefined;
      }
    } else if (hasCompleteIdentity(input.remoteIdentity)) {
      nextMeta.datasetId = input.remoteIdentity.datasetId ?? undefined;
      nextMeta.generation =
        input.remoteIdentity.generation ?? input.remoteIdentity.epoch ?? undefined;
      nextMeta.quarantine = undefined;
    }

    if (!allowKnowledgeWrites) {
      await persistSyncMetaRecord(db, nextMeta);
      return;
    }

    for (const snap of pages) {
      // A delta page contains the latest operation for each entity within that
      // page. Replay pages in cursor order so a later-page delete cannot be
      // resurrected by an earlier-page upsert (and vice versa).
      if (input.allowTombstones) {
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
      }
      if (snap.sources.length > 0) {
        const existing = await db.sources.bulkGet(snap.sources.map((source) => source.id));
        const toPut: Source[] = [];
        for (let i = 0; i < snap.sources.length; i += 1) {
          const remote = snap.sources[i];
          const local = existing[i];
          const remoteRevision = remote.updatedAt ?? remote.ingestedAt;
          const localRevision = local ? (local.updatedAt ?? local.ingestedAt) : -1;
          if (!local || remoteRevision >= localRevision)
            toPut.push(mergeRemoteSource(local, remote));
          else skipped.sources += 1;
        }
        if (toPut.length > 0) {
          await db.sources.bulkPut(toPut);
          applied.sources += toPut.length;
        }
      }
      if (snap.concepts.length > 0) {
        const existing = await db.concepts.bulkGet(snap.concepts.map((concept) => concept.id));
        const toPut: Concept[] = [];
        for (let i = 0; i < snap.concepts.length; i += 1) {
          const remote = snap.concepts[i];
          const local = existing[i];
          if (!local || remote.updatedAt >= local.updatedAt)
            toPut.push(mergeRemoteConcept(local, remote));
          else skipped.concepts += 1;
        }
        if (toPut.length > 0) {
          await db.concepts.bulkPut(toPut);
          applied.concepts += toPut.length;
        }
      }
      if (snap.activity.length > 0) {
        const existing = await db.activity.bulkGet(snap.activity.map((row) => row.id));
        const toPut: ActivityLog[] = [];
        for (let i = 0; i < snap.activity.length; i += 1) {
          const remote = snap.activity[i];
          const local = existing[i];
          if (!local || remote.at > local.at) toPut.push(remote);
          else skipped.activity += 1;
        }
        if (toPut.length > 0) {
          await db.activity.bulkPut(toPut);
          applied.activity += toPut.length;
        }
      }
      if (snap.ask.length > 0) {
        const existing = await db.askHistory.bulkGet(snap.ask.map((row) => row.id));
        const toPut: AskMessage[] = [];
        for (let i = 0; i < snap.ask.length; i += 1) {
          const remote = snap.ask[i];
          const local = existing[i];
          if (!local || remote.at > local.at) toPut.push(remote);
          else skipped.ask += 1;
        }
        if (toPut.length > 0) {
          await db.askHistory.bulkPut(toPut);
          applied.ask += toPut.length;
        }
      }
    }

    if (sourceIdsToDelete.length > 0) {
      await db.sources.bulkDelete(sourceIdsToDelete);
      applied.sources += sourceIdsToDelete.length;
    }
    if (conceptIdsToDelete.length > 0) {
      await db.concepts.bulkDelete(conceptIdsToDelete);
      applied.concepts += conceptIdsToDelete.length;
    }
    // Activity and ask history include browser-only rows. A full snapshot may
    // merge server copies, but absence from the server is not a tombstone.
    // Explicit, identity-checked delta tombstones remain authoritative above.

    if (allowAdvanceCursor && hasCompleteIdentity(nextMeta)) {
      nextMeta.cursor = input.upperCursor;
    }

    await persistSyncMetaRecord(db, nextMeta);
  });

  return {
    result: {
      pulledAt: input.pulledAt,
      authoritativeEmpty,
      reconcileMode,
      destructiveReconcileBlocked,
      quarantine,
      applied,
      skipped,
    },
  };
}

async function pullSnapshotPass(input: {
  db: CompoundDB;
  meta: SyncMetaRecord;
  requestCursor: number | null;
  forceFull: boolean;
}): Promise<PullPassResult> {
  const { pages, truncated } = await fetchAllSnapshotPages({
    requestCursor: input.requestCursor,
    forceFull: input.forceFull,
  });
  return validateAndApplySnapshotPages({
    db: input.db,
    meta: input.meta,
    pages,
    forceFull: input.forceFull,
    truncated,
  });
}

export async function getLastSyncCursor(): Promise<number | null> {
  try {
    const meta = await loadSyncMeta();
    return normalizeSyncCursor(meta.cursor ?? null);
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
