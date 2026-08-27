/**
 * Full-snapshot reconciliation policy for cloud → IndexedDB sync.
 *
 * Untrusted fallback full snapshots (cursor rollback, empty volume, restored
 * stale backup, missing dataset identity) may only merge/upsert. They must not
 * delete the browser's last copy of sources/concepts.
 */

export const SYNC_QUARANTINE_KEY = 'compound:syncQuarantine';
export const SYNC_META_KEY = 'compound:syncMeta';
export const DESTRUCTIVE_RECONCILE_BLOCKED = 'destructive_reconcile_blocked';
export const QUARANTINE_SAMPLE_LIMIT = 50;

export type ReconcileReason = 'first_bind' | 'trusted_identity' | 'untrusted_forced_full';

export type ReconcileMode = 'delta' | 'destructive_full' | 'merge_only';

export interface DatasetIdentity {
  datasetId?: string | null;
  generation?: number | null;
  epoch?: number | null;
}

export interface FullReconcilePlan {
  allowDestructiveDelete: boolean;
  reason: ReconcileReason;
  trusted: boolean;
  staleSourceIds: string[];
  staleConceptIds: string[];
}

export interface DestructiveDeleteDecision {
  sourceIdsToDelete: string[];
  conceptIdsToDelete: string[];
  blocked: boolean;
}

export interface SyncQuarantine {
  at: number;
  reason: ReconcileReason;
  code: typeof DESTRUCTIVE_RECONCILE_BLOCKED;
  staleSourceCount: number;
  staleConceptCount: number;
  sampleSourceIds: string[];
  sampleConceptIds: string[];
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
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
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

export function collectStaleIds(
  localIds: Array<string | number>,
  remoteIds: Iterable<string>,
): string[] {
  const remote = remoteIds instanceof Set ? remoteIds : new Set(remoteIds);
  return localIds.map(String).filter((id) => !remote.has(id));
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
}): FullReconcilePlan {
  const staleSourceIds = collectStaleIds(input.localSourceIds, input.remoteSourceIds);
  const staleConceptIds = collectStaleIds(input.localConceptIds, input.remoteConceptIds);
  const trusted = identitiesMatch(input.localIdentity, input.remoteIdentity);
  if (trusted) {
    return {
      allowDestructiveDelete: true,
      reason: 'trusted_identity',
      trusted: true,
      staleSourceIds,
      staleConceptIds,
    };
  }
  const bound = input.hadLocalCursor || Boolean(input.hadLocalBinding);
  if (!bound) {
    return {
      allowDestructiveDelete: true,
      reason: 'first_bind',
      trusted: false,
      staleSourceIds,
      staleConceptIds,
    };
  }
  return {
    allowDestructiveDelete: false,
    reason: 'untrusted_forced_full',
    trusted: false,
    staleSourceIds,
    staleConceptIds,
  };
}

export function resolveDestructiveDeletes(plan: FullReconcilePlan): DestructiveDeleteDecision {
  if (plan.allowDestructiveDelete) {
    return {
      sourceIdsToDelete: plan.staleSourceIds,
      conceptIdsToDelete: plan.staleConceptIds,
      blocked: false,
    };
  }
  return {
    sourceIdsToDelete: [],
    conceptIdsToDelete: [],
    blocked: plan.staleSourceIds.length > 0 || plan.staleConceptIds.length > 0,
  };
}

export function buildQuarantineRecord(input: {
  at: number;
  reason: ReconcileReason;
  staleSourceIds: string[];
  staleConceptIds: string[];
  localCursor: number | null;
  remoteCursor: number | null;
}): SyncQuarantine {
  return {
    at: input.at,
    reason: input.reason,
    code: DESTRUCTIVE_RECONCILE_BLOCKED,
    staleSourceCount: input.staleSourceIds.length,
    staleConceptCount: input.staleConceptIds.length,
    sampleSourceIds: input.staleSourceIds.slice(0, QUARANTINE_SAMPLE_LIMIT),
    sampleConceptIds: input.staleConceptIds.slice(0, QUARANTINE_SAMPLE_LIMIT),
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
