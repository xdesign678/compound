import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DESTRUCTIVE_RECONCILE_BLOCKED,
  buildQuarantineRecord,
  identitiesMatch,
  planFullReconciliation,
  readDatasetIdentity,
  resolveDestructiveDeletes,
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

test('first bind without a local cursor may delete stale ids (trusted first full)', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: false,
    localSourceIds: ['local-s', 'shared-s'],
    localConceptIds: ['local-c'],
    remoteSourceIds: ['shared-s', 'remote-s'],
    remoteConceptIds: ['remote-c'],
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'first_bind');
  assert.equal(plan.allowDestructiveDelete, true);
  assert.deepEqual(deletes.sourceIdsToDelete, ['local-s']);
  assert.deepEqual(deletes.conceptIdsToDelete, ['local-c']);
  assert.equal(deletes.blocked, false);
});

test('trusted dataset identity allows destructive full reconciliation', () => {
  const plan = planFullReconciliation({
    hadLocalCursor: true,
    localIdentity,
    remoteIdentity: matchingRemote,
    localSourceIds: ['keep', 'stale'],
    localConceptIds: ['keep-c', 'stale-c'],
    remoteSourceIds: ['keep'],
    remoteConceptIds: ['keep-c'],
  });
  const deletes = resolveDestructiveDeletes(plan);

  assert.equal(plan.reason, 'trusted_identity');
  assert.equal(plan.trusted, true);
  assert.deepEqual(deletes.sourceIdsToDelete, ['stale']);
  assert.deepEqual(deletes.conceptIdsToDelete, ['stale-c']);
  assert.equal(deletes.blocked, false);
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

test('readDatasetIdentity ignores malformed sync meta', () => {
  assert.equal(readDatasetIdentity(null), null);
  assert.equal(readDatasetIdentity('{'), null);
  assert.deepEqual(readDatasetIdentity(JSON.stringify({ datasetId: 'ds-1', generation: 2 })), {
    datasetId: 'ds-1',
    generation: 2,
    epoch: null,
  });
});
