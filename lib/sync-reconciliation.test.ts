import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESTRUCTIVE_RECONCILE_BLOCKED,
  buildQuarantineRecord,
  identitiesMatch,
  isCursorRollback,
  planDeltaTrust,
  planFullReconciliation,
  readDatasetIdentity,
  resolveDestructiveDeletes,
  validateSnapshotEnvelope,
} from './sync-reconciliation';

const localIdentity = { datasetId: 'ds-prod', generation: 4 };
const matchingRemote = { datasetId: 'ds-prod', generation: 4 };

test('identitiesMatch requires the same datasetId and generation/epoch', () => {
  assert.equal(identitiesMatch(localIdentity, matchingRemote), true);
  assert.equal(identitiesMatch(localIdentity, { datasetId: 'ds-prod', epoch: 4 }), true);
  assert.equal(identitiesMatch(localIdentity, { datasetId: 'ds-other', generation: 4 }), false);
  assert.equal(identitiesMatch(localIdentity, { datasetId: 'ds-prod', generation: 5 }), false);
  assert.equal(identitiesMatch(localIdentity, { datasetId: 'ds-prod' }), false);
  assert.equal(identitiesMatch({ datasetId: 'ds-prod' }, matchingRemote), false);
  assert.equal(identitiesMatch(null, matchingRemote), false);
});

test('first bind with empty local knowledge may bind an authoritative full', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    localEmpty: true,
    localSourceIds: [],
    localConceptIds: [],
    remoteSourceIds: ['remote-s'],
    remoteConceptIds: ['remote-c'],
    remoteIdentity: matchingRemote,
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'first_bind');
  assert.equal(plan.allowDestructiveDelete, true);
  assert.equal(plan.allowBindIdentity, true);
  assert.equal(plan.allowAdvanceCursor, true);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
  assert.deepEqual(deletes.conceptIdsToDelete, []);
  assert.equal(deletes.blocked, false);
});

test('first bind with non-empty local and empty remote is merge-only, never delete', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    hadLocalBinding: false,
    localEmpty: false,
    localSourceIds: ['last-local-copy'],
    localConceptIds: ['last-local-concept'],
    remoteSourceIds: [],
    remoteConceptIds: [],
    remoteIdentity: matchingRemote,
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'first_bind_nonempty');
  assert.equal(plan.allowDestructiveDelete, false);
  assert.equal(plan.allowBindIdentity, false);
  assert.equal(plan.allowAdvanceCursor, false);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
  assert.deepEqual(deletes.conceptIdsToDelete, []);
  assert.equal(deletes.blocked, true);
  assert.deepEqual(plan.staleSourceIds, ['last-local-copy']);
  assert.deepEqual(plan.staleConceptIds, ['last-local-concept']);
});

test('first bind with non-empty local and non-empty remote is merge-only', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    localEmpty: false,
    localSourceIds: ['local-s', 'shared-s'],
    localConceptIds: ['local-c'],
    remoteSourceIds: ['shared-s', 'remote-s'],
    remoteConceptIds: ['remote-c'],
    remoteIdentity: matchingRemote,
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'first_bind_nonempty');
  assert.equal(plan.allowDestructiveDelete, false);
  assert.equal(plan.allowBindIdentity, false);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
  assert.deepEqual(deletes.conceptIdsToDelete, []);
  assert.equal(deletes.blocked, true);
});

test('matching identity only deletes stale server-authoritative rows', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    localIdentity,
    remoteIdentity: matchingRemote,
    localSourceIds: ['keep', 'stale'],
    localConceptIds: ['keep-c', 'stale-c'],
    localActivityIds: ['keep-a', 'stale-a'],
    localAskIds: ['keep-q', 'stale-q'],
    remoteSourceIds: ['keep'],
    remoteConceptIds: ['keep-c'],
    remoteActivityIds: ['keep-a'],
    remoteAskIds: ['keep-q'],
    initialCursor: 10,
    remoteUpperCursor: 40,
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'trusted_identity');
  assert.equal(plan.trusted, true);
  assert.equal(plan.allowDestructiveDelete, true);
  assert.deepEqual(deletes.sourceIdsToDelete, ['stale']);
  assert.deepEqual(deletes.conceptIdsToDelete, ['stale-c']);
  assert.deepEqual(plan.staleActivityIds, ['stale-a']);
  assert.deepEqual(plan.staleAskIds, ['stale-q']);
  assert.equal(deletes.blocked, false);
});

test('matching identity without a cursor isolates non-empty local knowledge', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    hadLocalBinding: true,
    localIdentity,
    remoteIdentity: matchingRemote,
    localSourceIds: ['local-s'],
    localConceptIds: [],
    remoteSourceIds: ['local-s'],
    remoteConceptIds: [],
  });

  assert.equal(plan.reason, 'missing_cursor');
  assert.equal(plan.trusted, true);
  assert.equal(plan.allowDestructiveDelete, false);
  assert.equal(plan.allowBindIdentity, false);
  assert.equal(plan.allowAdvanceCursor, false);
  assert.equal(resolveDestructiveDeletes(plan).blocked, true);
});

test('matching identity with cursor rollback must not delete', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    hadLocalBinding: true,
    localIdentity,
    remoteIdentity: matchingRemote,
    localSourceIds: ['ahead-s'],
    localConceptIds: ['ahead-c'],
    remoteSourceIds: ['older-s'],
    remoteConceptIds: ['older-c'],
    initialCursor: 900,
    remoteUpperCursor: 12,
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(isCursorRollback(900, 12), true);
  assert.equal(plan.reason, 'cursor_rollback');
  assert.equal(plan.allowDestructiveDelete, false);
  assert.equal(plan.allowAdvanceCursor, false);
  assert.equal(deletes.blocked, true);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
  assert.deepEqual(deletes.conceptIdsToDelete, []);
});

test('authoritative empty forced-full with a local cursor must not delete the last copy', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    localSourceIds: ['s-1', 's-2'],
    localConceptIds: ['c-1'],
    remoteSourceIds: [],
    remoteConceptIds: [],
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'untrusted_forced_full');
  assert.equal(plan.allowDestructiveDelete, false);
  assert.deepEqual(plan.staleSourceIds, ['s-1', 's-2']);
  assert.deepEqual(plan.staleConceptIds, ['c-1']);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
  assert.deepEqual(deletes.conceptIdsToDelete, []);
  assert.equal(deletes.blocked, true);
});

test('non-empty stale forced-full with a local cursor is merge-only', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    localSourceIds: ['local-only', 'shared'],
    localConceptIds: ['local-c', 'shared-c'],
    remoteSourceIds: ['shared', 'recovered-old'],
    remoteConceptIds: ['shared-c'],
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'untrusted_forced_full');
  assert.deepEqual(plan.staleSourceIds, ['local-only']);
  assert.deepEqual(plan.staleConceptIds, ['local-c']);
  assert.equal(deletes.blocked, true);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
  assert.deepEqual(deletes.conceptIdsToDelete, []);
});

test('cursor rollback forced-full without identity does not delete local extras', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    hadLocalBinding: true,
    localSourceIds: ['ahead-s'],
    localConceptIds: ['ahead-c'],
    remoteSourceIds: ['older-s'],
    remoteConceptIds: ['older-c'],
    initialCursor: 900,
    remoteUpperCursor: 12,
  });
  const deletes = resolveDestructiveDeletes(plan);
  const quarantine = buildQuarantineRecord({
    at: 1,
    reason: plan.reason,
    staleSourceIds: plan.staleSourceIds,
    staleConceptIds: plan.staleConceptIds,
    localCursor: 900,
    remoteCursor: 12,
  });

  assert.equal(plan.reason, 'untrusted_forced_full');
  assert.equal(deletes.blocked, true);
  assert.equal(quarantine.code, DESTRUCTIVE_RECONCILE_BLOCKED);
  assert.equal(quarantine.staleSourceCount, 1);
  assert.equal(quarantine.staleConceptCount, 1);
  assert.deepEqual(quarantine.sampleSourceIds, ['ahead-s']);
});

test('dataset mismatch with a local cursor is merge-only even when remote is non-empty', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    localIdentity,
    remoteIdentity: { datasetId: 'ds-restored', generation: 1 },
    localSourceIds: ['mine'],
    localConceptIds: ['mine-c'],
    remoteSourceIds: ['theirs'],
    remoteConceptIds: ['theirs-c'],
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.trusted, false);
  assert.equal(plan.allowDestructiveDelete, false);
  assert.equal(deletes.blocked, true);
});

test('delta tombstones are zero when identity is missing or mismatched', () => {
  const missing = planDeltaTrust({
    localIdentity: null,
    remoteIdentity: matchingRemote,
    initialCursor: 4,
    remoteUpperCursor: 9,
  });
  const mismatch = planDeltaTrust({
    localIdentity,
    remoteIdentity: { datasetId: 'ds-other', generation: 4 },
    initialCursor: 4,
    remoteUpperCursor: 9,
  });
  const rollback = planDeltaTrust({
    localIdentity,
    remoteIdentity: matchingRemote,
    initialCursor: 80,
    remoteUpperCursor: 12,
  });
  const trusted = planDeltaTrust({
    localIdentity,
    remoteIdentity: matchingRemote,
    initialCursor: 4,
    remoteUpperCursor: 9,
  });

  assert.equal(missing.allowTombstones, false);
  assert.equal(missing.allowAdvanceCursor, false);
  assert.equal(mismatch.allowTombstones, false);
  assert.equal(rollback.allowTombstones, false);
  assert.equal(trusted.allowTombstones, true);
  assert.equal(trusted.allowAdvanceCursor, true);
});

test('readDatasetIdentity ignores malformed sync meta', () => {
  assert.equal(readDatasetIdentity(null), null);
  assert.equal(readDatasetIdentity('{'), null);
  assert.deepEqual(readDatasetIdentity(JSON.stringify({ datasetId: 'ds-1', generation: 2 })), {
    datasetId: 'ds-1',
    generation: 2,
    epoch: null,
  });
});

test('first bind with empty local but missing generation cannot bind or advance cursor', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    localEmpty: true,
    localSourceIds: [],
    localConceptIds: [],
    remoteSourceIds: ['remote-s'],
    remoteConceptIds: [],
    remoteIdentity: { datasetId: 'ds-prod' },
  });
  const deletes = resolveDestructiveDeletes(plan);
  assert.equal(plan.reason, 'missing_identity');
  assert.equal(plan.allowBindIdentity, false);
  assert.equal(plan.allowAdvanceCursor, false);
  assert.equal(deletes.blocked, true);
  assert.deepEqual(deletes.sourceIdsToDelete, []);
});

test('first bind nonempty with only activity/ask rows still blocks even when source/concept stale is empty', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    localEmpty: false,
    localActivityCount: 2,
    localAskCount: 1,
    localSourceIds: ['shared'],
    localConceptIds: ['shared-c'],
    remoteSourceIds: ['shared'],
    remoteConceptIds: ['shared-c'],
    remoteIdentity: matchingRemote,
  });
  const deletes = resolveDestructiveDeletes(plan);
  assert.equal(plan.reason, 'first_bind_nonempty');
  assert.deepEqual(plan.staleSourceIds, []);
  assert.deepEqual(plan.staleConceptIds, []);
  assert.equal(plan.allowAdvanceCursor, false);
  assert.equal(deletes.blocked, true);
});

test('any full that cannot advance cursor reports blocked to the caller', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    localIdentity,
    remoteIdentity: matchingRemote,
    localSourceIds: ['keep'],
    localConceptIds: ['keep-c'],
    remoteSourceIds: ['keep', 'extra'],
    remoteConceptIds: ['keep-c'],
    initialCursor: 40,
    remoteUpperCursor: 10,
  });
  const deletes = resolveDestructiveDeletes(plan);
  assert.equal(plan.reason, 'cursor_rollback');
  assert.deepEqual(plan.staleSourceIds, []);
  assert.equal(deletes.blocked, true);
});

function envelopePage(overrides: {
  mode?: 'full' | 'delta';
  datasetId?: string;
  generation?: number;
  upperCursor?: number;
  hasMore?: boolean;
  offset?: number;
  limit?: number;
  totalSources?: number;
  totalConcepts?: number;
  omitPagination?: boolean;
  omitDataset?: boolean;
}) {
  return {
    mode: overrides.mode ?? 'full',
    dataset: overrides.omitDataset
      ? null
      : {
          datasetId: overrides.datasetId ?? 'ds-prod',
          generation: overrides.generation ?? 4,
        },
    pagination: overrides.omitPagination
      ? null
      : {
          limit: overrides.limit ?? 2,
          offset: overrides.offset ?? 0,
          totalSources: overrides.totalSources ?? 4,
          totalConcepts: overrides.totalConcepts ?? 0,
          totalActivity: 0,
          totalAsk: 0,
        },
    sync: {
      cursor: overrides.upperCursor ?? 9,
      upperCursor: overrides.upperCursor ?? 9,
      hasMore: overrides.hasMore ?? false,
      deleted: { sources: [], concepts: [], activity: [], ask: [] },
    },
    sources: [],
    concepts: [],
    activity: [],
    ask: [],
  };
}

test('snapshot envelope accepts consistent full pages', () => {
  const result = validateSnapshotEnvelope([
    envelopePage({ offset: 0, hasMore: true }),
    envelopePage({ offset: 2, hasMore: false }),
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, 'full');
    assert.equal(result.upperCursor, 9);
    assert.equal(result.identity.datasetId, 'ds-prod');
    assert.equal(result.identity.generation, 4);
  }
});

test('snapshot envelope rejects mixed identities, cursors, modes, and pagination gaps', () => {
  assert.equal(
    validateSnapshotEnvelope([
      envelopePage({ offset: 0 }),
      envelopePage({ offset: 2, datasetId: 'ds-other' }),
    ]).ok,
    false,
  );
  assert.equal(
    validateSnapshotEnvelope([
      envelopePage({ offset: 0, upperCursor: 9 }),
      envelopePage({ offset: 2, upperCursor: 3 }),
    ]).ok,
    false,
  );
  assert.equal(
    validateSnapshotEnvelope([
      envelopePage({ mode: 'full', offset: 0 }),
      envelopePage({ mode: 'delta', offset: 2, omitPagination: true }),
    ]).ok,
    false,
  );
  assert.equal(
    validateSnapshotEnvelope([envelopePage({ offset: 0 }), envelopePage({ offset: 3 })]).ok,
    false,
  );
  assert.equal(validateSnapshotEnvelope([envelopePage({ omitDataset: true })]).ok, false);
  assert.equal(
    validateSnapshotEnvelope([envelopePage({ generation: Number.NaN, omitDataset: false })]).ok,
    false,
  );
  for (const invalidGeneration of [0, -1, 1.5]) {
    assert.equal(
      validateSnapshotEnvelope([
        envelopePage({ generation: invalidGeneration, omitDataset: false }),
      ]).ok,
      false,
      `generation=${invalidGeneration}`,
    );
  }
  const missingSync = envelopePage({});
  missingSync.sync = undefined as never;
  assert.doesNotThrow(() => validateSnapshotEnvelope([missingSync]));
  assert.equal(validateSnapshotEnvelope([missingSync]).ok, false);
});

test('snapshot envelope rejects full pages that omit four-table totals or start after offset 0', () => {
  assert.equal(
    validateSnapshotEnvelope([
      {
        mode: 'full',
        dataset: matchingRemote,
        pagination: { limit: 10, offset: 0, totalSources: 0, totalConcepts: 0 },
        sync: { cursor: 1, upperCursor: 1, hasMore: false },
      },
    ]).ok,
    false,
  );
  assert.equal(validateSnapshotEnvelope([envelopePage({ offset: 2, hasMore: false })]).ok, false);
});

test('snapshot envelope rejects a lying full hasMore flag', () => {
  const lying = validateSnapshotEnvelope([
    envelopePage({ offset: 0, limit: 2, totalSources: 2, hasMore: true }),
  ]);
  assert.equal(lying.ok, false);
  if (!lying.ok) assert.equal(lying.reason, 'has_more_mismatch');
});

test('snapshot envelope rejects truncated fetches that still claim hasMore', () => {
  const truncated = validateSnapshotEnvelope(
    [envelopePage({ offset: 0, hasMore: true, totalSources: 4 })],
    { truncated: true },
  );
  assert.equal(truncated.ok, false);
  if (!truncated.ok) assert.equal(truncated.reason, 'truncated_pages');
});

test('snapshot envelope rejects delta cursor stall, rollback, and unfinished upperCursor', () => {
  const stall = validateSnapshotEnvelope([
    { mode: 'delta', dataset: matchingRemote, sync: { cursor: 4, upperCursor: 9, hasMore: true } },
    { mode: 'delta', dataset: matchingRemote, sync: { cursor: 4, upperCursor: 9, hasMore: true } },
  ]);
  const rollback = validateSnapshotEnvelope([
    { mode: 'delta', dataset: matchingRemote, sync: { cursor: 6, upperCursor: 9, hasMore: true } },
    { mode: 'delta', dataset: matchingRemote, sync: { cursor: 5, upperCursor: 9, hasMore: true } },
  ]);
  const unfinished = validateSnapshotEnvelope([
    { mode: 'delta', dataset: matchingRemote, sync: { cursor: 4, upperCursor: 9, hasMore: true } },
    { mode: 'delta', dataset: matchingRemote, sync: { cursor: 8, upperCursor: 9, hasMore: false } },
  ]);
  assert.equal(stall.ok, false);
  assert.equal(rollback.ok, false);
  assert.equal(unfinished.ok, false);
});

test('snapshot envelope requires complete generation and delta hasMore termination', () => {
  assert.equal(
    validateSnapshotEnvelope([
      {
        mode: 'full',
        dataset: { datasetId: 'ds-prod' },
        pagination: { limit: 10, offset: 0, totalSources: 0, totalConcepts: 0 },
        sync: { cursor: 1, upperCursor: 1, hasMore: false },
      },
    ]).ok,
    false,
  );
  assert.equal(
    validateSnapshotEnvelope([
      {
        mode: 'delta',
        dataset: matchingRemote,
        sources: [],
        concepts: [],
        activity: [],
        ask: [],
        sync: {
          cursor: 4,
          upperCursor: 9,
          hasMore: true,
          deleted: { sources: [], concepts: [], activity: [], ask: [] },
        },
      },
      {
        mode: 'delta',
        dataset: matchingRemote,
        sources: [],
        concepts: [],
        activity: [],
        ask: [],
        sync: {
          cursor: 9,
          upperCursor: 9,
          hasMore: false,
          deleted: { sources: [], concepts: [], activity: [], ask: [] },
        },
      },
    ]).ok,
    true,
  );
  assert.equal(
    validateSnapshotEnvelope([
      {
        mode: 'delta',
        dataset: matchingRemote,
        sync: { cursor: 4, upperCursor: 9, hasMore: true },
      },
      {
        mode: 'delta',
        dataset: matchingRemote,
        sync: { cursor: 9, upperCursor: 9, hasMore: true },
      },
    ]).ok,
    false,
  );
});
