/**
 * Full-snapshot reconciliation policy for cloud → IndexedDB sync.
 *
 * Untrusted snapshots (cursor rollback, empty volume, restored stale backup,
 * missing dataset identity) are isolated without touching browser knowledge or
 * advancing sync metadata. Recovery is an explicit user action.
 *
 * First bind of a non-empty local library is isolated. Authoritative full
 * bind (and destructive delete) is allowed only when all four knowledge tables
 * are empty, or when a matching dataset identity is already bound and the
 * remote cursor has not rolled back.
 */

export const SYNC_QUARANTINE_KEY = 'compound:syncQuarantine';
export const SYNC_META_KEY = 'compound:syncMeta';
export const LAST_SYNC_CURSOR_KEY = 'compound:lastSyncCursor';
export const DESTRUCTIVE_RECONCILE_BLOCKED = 'destructive_reconcile_blocked';
export const QUARANTINE_SAMPLE_LIMIT = 50;

export type ReconcileReason =
  | 'first_bind'
  | 'first_bind_nonempty'
  | 'trusted_identity'
  | 'missing_cursor'
  | 'cursor_rollback'
  | 'untrusted_forced_full'
  | 'missing_identity'
  | 'identity_mismatch'
  | 'envelope_mismatch'
  | 'payload_count_mismatch'
  | 'duplicate_entity_id';

export type ReconcileMode = 'delta' | 'destructive_full' | 'isolated';

export type DeltaTrustReason =
  | 'trusted_identity'
  | 'missing_identity'
  | 'identity_mismatch'
  | 'cursor_rollback';

export interface DatasetIdentity {
  datasetId?: string | null;
  generation?: number | null;
  epoch?: number | null;
}

export interface FullReconcilePlan {
  allowDestructiveDelete: boolean;
  allowBindIdentity: boolean;
  allowAdvanceCursor: boolean;
  reason: ReconcileReason;
  trusted: boolean;
  staleSourceIds: string[];
  staleConceptIds: string[];
  staleActivityIds: string[];
  staleAskIds: string[];
}

export interface DestructiveDeleteDecision {
  sourceIdsToDelete: string[];
  conceptIdsToDelete: string[];
  blocked: boolean;
}

export interface DeltaTrustPlan {
  allowTombstones: boolean;
  allowAdvanceCursor: boolean;
  reason: DeltaTrustReason;
  trusted: boolean;
}

export interface SyncQuarantine {
  at: number;
  reason: ReconcileReason;
  code: typeof DESTRUCTIVE_RECONCILE_BLOCKED;
  staleSourceCount: number;
  staleConceptCount: number;
  sampleSourceIds: string[];
  sampleConceptIds: string[];
  staleActivityCount?: number;
  staleAskCount?: number;
  sampleActivityIds?: string[];
  sampleAskIds?: string[];
  localCursor: number | null;
  remoteCursor: number | null;
}

function trimId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeGeneration(identity: DatasetIdentity | null | undefined): number | null {
  if (!identity) return null;
  const value = identity.generation ?? identity.epoch;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
  return value;
}

export function identitiesMatch(
  local: DatasetIdentity | null | undefined,
  remote: DatasetIdentity | null | undefined,
): boolean {
  const localId = trimId(local?.datasetId);
  const remoteId = trimId(remote?.datasetId);
  if (!localId || !remoteId || localId !== remoteId) return false;
  const localGen = normalizeGeneration(local);
  const remoteGen = normalizeGeneration(remote);
  if (localGen === null || remoteGen === null) return false;
  return localGen === remoteGen;
}

export function hasCompleteIdentity(identity: DatasetIdentity | null | undefined): boolean {
  return trimId(identity?.datasetId) !== null && normalizeGeneration(identity) !== null;
}

export function isCursorRollback(
  initialCursor: number | null | undefined,
  remoteUpperCursor: number | null | undefined,
): boolean {
  if (initialCursor == null || remoteUpperCursor == null) return false;
  if (!Number.isFinite(initialCursor) || !Number.isFinite(remoteUpperCursor)) return false;
  return initialCursor > remoteUpperCursor;
}

export function collectStaleIds(
  localIds: Array<string | number>,
  remoteIds: Iterable<string>,
): string[] {
  const remote = remoteIds instanceof Set ? remoteIds : new Set(remoteIds);
  return localIds.map(String).filter((id) => !remote.has(id));
}

export function isLocalKnowledgeEmpty(input: {
  localSourceIds?: Array<string | number>;
  localConceptIds?: Array<string | number>;
  localActivityIds?: Array<string | number>;
  localAskIds?: Array<string | number>;
  localActivityCount?: number;
  localAskCount?: number;
  localEmpty?: boolean;
}): boolean {
  if (typeof input.localEmpty === 'boolean') return input.localEmpty;
  return (
    (input.localSourceIds?.length ?? 0) === 0 &&
    (input.localConceptIds?.length ?? 0) === 0 &&
    (input.localActivityIds?.length ?? input.localActivityCount ?? 0) === 0 &&
    (input.localAskIds?.length ?? input.localAskCount ?? 0) === 0
  );
}

export function planFullReconciliation(input: {
  hadLocalCursor: boolean;
  hadLocalBinding?: boolean;
  localIdentity?: DatasetIdentity | null;
  remoteIdentity?: DatasetIdentity | null;
  localSourceIds: Array<string | number>;
  localConceptIds: Array<string | number>;
  remoteSourceIds: Iterable<string>;
  remoteConceptIds: Iterable<string>;
  localActivityIds?: Array<string | number>;
  localAskIds?: Array<string | number>;
  localActivityCount?: number;
  localAskCount?: number;
  remoteActivityIds?: Iterable<string>;
  remoteAskIds?: Iterable<string>;
  localEmpty?: boolean;
  initialCursor?: number | null;
  remoteUpperCursor?: number | null;
}): FullReconcilePlan {
  const staleSourceIds = collectStaleIds(input.localSourceIds, input.remoteSourceIds);
  const staleConceptIds = collectStaleIds(input.localConceptIds, input.remoteConceptIds);
  const staleActivityIds = collectStaleIds(
    input.localActivityIds ?? [],
    input.remoteActivityIds ?? [],
  );
  const staleAskIds = collectStaleIds(input.localAskIds ?? [], input.remoteAskIds ?? []);
  const trusted = identitiesMatch(input.localIdentity, input.remoteIdentity);
  const rollback = isCursorRollback(input.initialCursor ?? null, input.remoteUpperCursor ?? null);
  const localKnowledgeEmpty = isLocalKnowledgeEmpty(input);

  if (trusted && rollback) {
    return {
      allowDestructiveDelete: false,
      allowBindIdentity: false,
      allowAdvanceCursor: false,
      reason: 'cursor_rollback',
      trusted: true,
      staleSourceIds,
      staleConceptIds,
      staleActivityIds,
      staleAskIds,
    };
  }

  if (trusted && !input.hadLocalCursor && !localKnowledgeEmpty) {
    return {
      allowDestructiveDelete: false,
      allowBindIdentity: false,
      allowAdvanceCursor: false,
      reason: 'missing_cursor',
      trusted: true,
      staleSourceIds,
      staleConceptIds,
      staleActivityIds,
      staleAskIds,
    };
  }

  if (trusted) {
    return {
      allowDestructiveDelete: true,
      allowBindIdentity: true,
      allowAdvanceCursor: true,
      reason: 'trusted_identity',
      trusted: true,
      staleSourceIds,
      staleConceptIds,
      staleActivityIds,
      staleAskIds,
    };
  }

  const bound = input.hadLocalCursor || Boolean(input.hadLocalBinding);
  if (!bound) {
    if (localKnowledgeEmpty && hasCompleteIdentity(input.remoteIdentity)) {
      return {
        allowDestructiveDelete: true,
        allowBindIdentity: true,
        allowAdvanceCursor: true,
        reason: 'first_bind',
        trusted: false,
        staleSourceIds,
        staleConceptIds,
        staleActivityIds,
        staleAskIds,
      };
    }
    if (localKnowledgeEmpty) {
      return {
        allowDestructiveDelete: false,
        allowBindIdentity: false,
        allowAdvanceCursor: false,
        reason: 'missing_identity',
        trusted: false,
        staleSourceIds,
        staleConceptIds,
        staleActivityIds,
        staleAskIds,
      };
    }
    return {
      allowDestructiveDelete: false,
      allowBindIdentity: false,
      allowAdvanceCursor: false,
      reason: 'first_bind_nonempty',
      trusted: false,
      staleSourceIds,
      staleConceptIds,
      staleActivityIds,
      staleAskIds,
    };
  }

  if (hasCompleteIdentity(input.localIdentity) && hasCompleteIdentity(input.remoteIdentity)) {
    return {
      allowDestructiveDelete: false,
      allowBindIdentity: false,
      allowAdvanceCursor: false,
      reason: 'identity_mismatch',
      trusted: false,
      staleSourceIds,
      staleConceptIds,
      staleActivityIds,
      staleAskIds,
    };
  }

  return {
    allowDestructiveDelete: false,
    allowBindIdentity: false,
    allowAdvanceCursor: false,
    reason: 'untrusted_forced_full',
    trusted: false,
    staleSourceIds,
    staleConceptIds,
    staleActivityIds,
    staleAskIds,
  };
}

export function planDeltaTrust(input: {
  localIdentity?: DatasetIdentity | null;
  remoteIdentity?: DatasetIdentity | null;
  initialCursor?: number | null;
  remoteUpperCursor?: number | null;
}): DeltaTrustPlan {
  if (!hasCompleteIdentity(input.localIdentity) || !hasCompleteIdentity(input.remoteIdentity)) {
    return {
      allowTombstones: false,
      allowAdvanceCursor: false,
      reason: 'missing_identity',
      trusted: false,
    };
  }
  if (!identitiesMatch(input.localIdentity, input.remoteIdentity)) {
    return {
      allowTombstones: false,
      allowAdvanceCursor: false,
      reason: 'identity_mismatch',
      trusted: false,
    };
  }
  if (isCursorRollback(input.initialCursor ?? null, input.remoteUpperCursor ?? null)) {
    return {
      allowTombstones: false,
      allowAdvanceCursor: false,
      reason: 'cursor_rollback',
      trusted: false,
    };
  }
  return {
    allowTombstones: true,
    allowAdvanceCursor: true,
    reason: 'trusted_identity',
    trusted: true,
  };
}

export function resolveDestructiveDeletes(plan: FullReconcilePlan): DestructiveDeleteDecision {
  if (plan.allowDestructiveDelete && plan.allowAdvanceCursor) {
    return {
      sourceIdsToDelete: plan.staleSourceIds,
      conceptIdsToDelete: plan.staleConceptIds,
      blocked: false,
    };
  }
  return {
    sourceIdsToDelete: [],
    conceptIdsToDelete: [],
    blocked: true,
  };
}

export type SnapshotEnvelopeReason =
  | 'empty_pages'
  | 'identity_incomplete'
  | 'identity_mismatch'
  | 'cursor_mismatch'
  | 'mode_mismatch'
  | 'pagination_gap'
  | 'has_more_mismatch'
  | 'payload_shape_mismatch'
  | 'truncated_pages';

export type SnapshotPayloadReason = 'payload_count_mismatch' | 'duplicate_entity_id';

export interface SnapshotFourTableTotals {
  totalSources: number;
  totalConcepts: number;
  totalActivity: number;
  totalAsk: number;
}

export interface SnapshotEnvelopePage {
  mode?: 'full' | 'delta';
  dataset?: DatasetIdentity | null;
  pagination?: {
    limit: number;
    offset: number;
    totalSources: number;
    totalConcepts: number;
    totalActivity?: number;
    totalAsk?: number;
  } | null;
  sync?: {
    cursor: number;
    upperCursor: number;
    hasMore: boolean;
    deleted?: {
      sources: string[];
      concepts: string[];
      activity: string[];
      ask: string[];
    };
  };
  sources?: Array<{ id: unknown }>;
  concepts?: Array<{ id: unknown }>;
  activity?: Array<{ id: unknown }>;
  ask?: Array<{ id: unknown }>;
}

function hasValidIdRows(rows: unknown): rows is Array<{ id: string }> {
  return (
    Array.isArray(rows) &&
    rows.every(
      (row) =>
        row !== null &&
        typeof row === 'object' &&
        typeof (row as { id?: unknown }).id === 'string' &&
        (row as { id: string }).id.trim().length > 0,
    )
  );
}

function hasValidDeletedArrays(deleted: unknown): deleted is {
  sources: string[];
  concepts: string[];
  activity: string[];
  ask: string[];
} {
  if (!deleted || typeof deleted !== 'object') return false;
  const value = deleted as Record<string, unknown>;
  return ['sources', 'concepts', 'activity', 'ask'].every((key) => {
    const ids = value[key];
    return Array.isArray(ids) && ids.every((id) => typeof id === 'string' && id.trim().length > 0);
  });
}

export function readFourTableTotals(
  pagination: SnapshotEnvelopePage['pagination'],
): SnapshotFourTableTotals | null {
  if (!pagination) return null;
  const totals = {
    totalSources: pagination.totalSources,
    totalConcepts: pagination.totalConcepts,
    totalActivity: pagination.totalActivity,
    totalAsk: pagination.totalAsk,
  };
  for (const value of Object.values(totals)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  }
  return totals as SnapshotFourTableTotals;
}

export function fullSnapshotHasMore(
  pagination: { offset: number; limit: number } & SnapshotFourTableTotals,
): boolean {
  const nextOffset = pagination.offset + pagination.limit;
  return (
    nextOffset < pagination.totalSources ||
    nextOffset < pagination.totalConcepts ||
    nextOffset < pagination.totalActivity ||
    nextOffset < pagination.totalAsk
  );
}

export function isAuthoritativeEmptySnapshot(totals: SnapshotFourTableTotals | null): boolean {
  if (!totals) return false;
  return (
    totals.totalSources === 0 &&
    totals.totalConcepts === 0 &&
    totals.totalActivity === 0 &&
    totals.totalAsk === 0
  );
}

export type SnapshotEnvelopeValidation =
  | {
      ok: true;
      identity: DatasetIdentity;
      upperCursor: number;
      mode: 'full' | 'delta';
    }
  | { ok: false; reason: SnapshotEnvelopeReason };

export function validateSnapshotEnvelope(
  pages: SnapshotEnvelopePage[],
  options: { truncated?: boolean; initialCursor?: number | null } = {},
): SnapshotEnvelopeValidation {
  if (pages.length === 0) return { ok: false, reason: 'empty_pages' };
  if (options.truncated) return { ok: false, reason: 'truncated_pages' };
  const first = pages[0];
  if (first.mode !== 'full' && first.mode !== 'delta') {
    return { ok: false, reason: 'mode_mismatch' };
  }
  const mode = first.mode;
  const firstSync = first.sync;
  if (!firstSync) return { ok: false, reason: 'cursor_mismatch' };
  const upperCursor = firstSync.upperCursor;
  if (typeof upperCursor !== 'number' || !Number.isInteger(upperCursor) || upperCursor < 0) {
    return { ok: false, reason: 'cursor_mismatch' };
  }
  if (!hasCompleteIdentity(first.dataset)) {
    return { ok: false, reason: 'identity_incomplete' };
  }

  let previousDeltaCursor: number | null = null;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const sync = page.sync;
    if (!sync) return { ok: false, reason: 'cursor_mismatch' };
    if (page.mode !== mode) return { ok: false, reason: 'mode_mismatch' };
    if (sync.upperCursor !== upperCursor) return { ok: false, reason: 'cursor_mismatch' };
    if (!hasCompleteIdentity(page.dataset) || !identitiesMatch(first.dataset, page.dataset)) {
      return {
        ok: false,
        reason: hasCompleteIdentity(page.dataset) ? 'identity_mismatch' : 'identity_incomplete',
      };
    }
    if (
      !hasValidIdRows(page.sources) ||
      !hasValidIdRows(page.concepts) ||
      !hasValidIdRows(page.activity) ||
      !hasValidIdRows(page.ask) ||
      !hasValidDeletedArrays(sync.deleted)
    ) {
      return { ok: false, reason: 'payload_shape_mismatch' };
    }

    const isLast = index === pages.length - 1;
    if (mode === 'delta') {
      const cursor = sync.cursor;
      if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) {
        return { ok: false, reason: 'cursor_mismatch' };
      }
      if (cursor > upperCursor) return { ok: false, reason: 'cursor_mismatch' };
      if (previousDeltaCursor !== null && cursor <= previousDeltaCursor) {
        return { ok: false, reason: 'cursor_mismatch' };
      }
      if (index === 0 && options.initialCursor != null && cursor <= options.initialCursor) {
        const noChange =
          pages.length === 1 &&
          options.initialCursor === upperCursor &&
          cursor === options.initialCursor &&
          sync.hasMore === false &&
          [page.sources, page.concepts, page.activity, page.ask].every(
            (rows) => Array.isArray(rows) && rows.length === 0,
          ) &&
          Object.values(sync.deleted).every((ids) => ids.length === 0);
        if (!noChange) return { ok: false, reason: 'cursor_mismatch' };
      }
      const expectedHasMore = cursor < upperCursor;
      if (sync.hasMore !== expectedHasMore) return { ok: false, reason: 'has_more_mismatch' };
      if (isLast && cursor !== upperCursor) return { ok: false, reason: 'cursor_mismatch' };
      previousDeltaCursor = cursor;
    }

    if (mode === 'full') {
      if (!Number.isInteger(sync.cursor) || sync.cursor !== upperCursor) {
        return { ok: false, reason: 'cursor_mismatch' };
      }
      const firstPagination = first.pagination;
      const firstTotals = readFourTableTotals(firstPagination);
      if (!firstPagination || !firstTotals) {
        return { ok: false, reason: 'pagination_gap' };
      }
      if (index === 0 && firstPagination.offset !== 0) {
        return { ok: false, reason: 'pagination_gap' };
      }
      const pagination = page.pagination;
      const totals = readFourTableTotals(pagination);
      if (!pagination || !totals) return { ok: false, reason: 'pagination_gap' };
      if (
        pagination.limit !== firstPagination.limit ||
        !Number.isInteger(pagination.limit) ||
        pagination.limit <= 0 ||
        !Number.isInteger(pagination.offset) ||
        totals.totalSources !== firstTotals.totalSources ||
        totals.totalConcepts !== firstTotals.totalConcepts ||
        totals.totalActivity !== firstTotals.totalActivity ||
        totals.totalAsk !== firstTotals.totalAsk
      ) {
        return { ok: false, reason: 'pagination_gap' };
      }
      const expectedOffset = index * firstPagination.limit;
      if (pagination.offset !== expectedOffset) return { ok: false, reason: 'pagination_gap' };
      const shouldHaveMore = fullSnapshotHasMore({
        offset: pagination.offset,
        limit: pagination.limit,
        ...totals,
      });
      if (sync.hasMore !== shouldHaveMore) return { ok: false, reason: 'has_more_mismatch' };
      if (isLast && sync.hasMore) return { ok: false, reason: 'has_more_mismatch' };
    }
  }

  return {
    ok: true,
    identity: {
      datasetId: first.dataset?.datasetId ?? null,
      generation: normalizeGeneration(first.dataset),
    },
    upperCursor,
    mode,
  };
}

export function validateFullSnapshotPayload(
  pages: SnapshotEnvelopePage[],
): { ok: true } | { ok: false; reason: SnapshotPayloadReason } {
  const seen = {
    sources: new Set<string>(),
    concepts: new Set<string>(),
    activity: new Set<string>(),
    ask: new Set<string>(),
  };
  for (const page of pages) {
    const pagination = page.pagination;
    const totals = readFourTableTotals(pagination);
    if (!pagination || !totals) return { ok: false, reason: 'payload_count_mismatch' };
    const tables = [
      ['sources', page.sources, totals.totalSources],
      ['concepts', page.concepts, totals.totalConcepts],
      ['activity', page.activity, totals.totalActivity],
      ['ask', page.ask, totals.totalAsk],
    ] as const;
    for (const [name, rows, total] of tables) {
      const expected = Math.max(0, Math.min(pagination.limit, total - pagination.offset));
      if (!Array.isArray(rows) || rows.length !== expected) {
        return { ok: false, reason: 'payload_count_mismatch' };
      }
      for (const row of rows) {
        if (typeof row.id !== 'string' || row.id.trim().length === 0) {
          return { ok: false, reason: 'payload_count_mismatch' };
        }
        if (seen[name].has(row.id)) return { ok: false, reason: 'duplicate_entity_id' };
        seen[name].add(row.id);
      }
    }
  }
  return { ok: true };
}

export function buildQuarantineRecord(input: {
  at: number;
  reason: ReconcileReason;
  staleSourceIds: string[];
  staleConceptIds: string[];
  staleActivityIds?: string[];
  staleAskIds?: string[];
  localCursor: number | null;
  remoteCursor: number | null;
}): SyncQuarantine {
  const staleActivityIds = input.staleActivityIds ?? [];
  const staleAskIds = input.staleAskIds ?? [];
  return {
    at: input.at,
    reason: input.reason,
    code: DESTRUCTIVE_RECONCILE_BLOCKED,
    staleSourceCount: input.staleSourceIds.length,
    staleConceptCount: input.staleConceptIds.length,
    sampleSourceIds: input.staleSourceIds.slice(0, QUARANTINE_SAMPLE_LIMIT),
    sampleConceptIds: input.staleConceptIds.slice(0, QUARANTINE_SAMPLE_LIMIT),
    staleActivityCount: staleActivityIds.length,
    staleAskCount: staleAskIds.length,
    sampleActivityIds: staleActivityIds.slice(0, QUARANTINE_SAMPLE_LIMIT),
    sampleAskIds: staleAskIds.slice(0, QUARANTINE_SAMPLE_LIMIT),
    localCursor: input.localCursor,
    remoteCursor: input.remoteCursor,
  };
}

export function readDatasetIdentity(raw: string | null | undefined): DatasetIdentity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DatasetIdentity;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      datasetId: typeof parsed.datasetId === 'string' ? parsed.datasetId : null,
      generation: typeof parsed.generation === 'number' ? parsed.generation : null,
      epoch: typeof parsed.epoch === 'number' ? parsed.epoch : null,
    };
  } catch {
    return null;
  }
}

export function readSyncQuarantine(raw: string | null | undefined): SyncQuarantine | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SyncQuarantine;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.code !== DESTRUCTIVE_RECONCILE_BLOCKED) return null;
    return parsed;
  } catch {
    return null;
  }
}
