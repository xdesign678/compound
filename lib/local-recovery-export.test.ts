import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLocalRecoveryExportFilename,
  exportLocalRecoverySnapshot,
  serializeLocalRecoveryExport,
  type LocalRecoveryDatabase,
} from './local-recovery-export';

test('local recovery export contains the four Dexie tables and sync meta only', async () => {
  const database = {
    sources: { toArray: async () => [{ id: 'source-local' }] },
    concepts: { toArray: async () => [{ id: 'concept-local' }] },
    activity: { toArray: async () => [{ id: 'activity-local' }] },
    askHistory: { toArray: async () => [{ id: 'ask-local' }] },
    syncMeta: {
      get: async () => ({
        id: 'current' as const,
        datasetId: 'device-dataset',
        generation: 3,
        cursor: 42,
        quarantine: null,
      }),
    },
  } as unknown as LocalRecoveryDatabase;

  const snapshot = await exportLocalRecoverySnapshot(database, 1_725_000_000_000);

  assert.deepEqual(snapshot, {
    format: 'compound-local-recovery',
    version: 1,
    exportedAt: 1_725_000_000_000,
    sources: [{ id: 'source-local' }],
    concepts: [{ id: 'concept-local' }],
    activity: [{ id: 'activity-local' }],
    askHistory: [{ id: 'ask-local' }],
    syncMeta: {
      id: 'current',
      datasetId: 'device-dataset',
      generation: 3,
      cursor: 42,
      quarantine: null,
    },
  });
  assert.deepEqual(JSON.parse(serializeLocalRecoveryExport(snapshot)), snapshot);
});

test('local recovery export represents missing sync meta explicitly', async () => {
  const table = { toArray: async () => [] };
  const database = {
    sources: table,
    concepts: table,
    activity: table,
    askHistory: table,
    syncMeta: { get: async () => undefined },
  } as unknown as LocalRecoveryDatabase;

  const snapshot = await exportLocalRecoverySnapshot(database, 1);

  assert.equal(snapshot.syncMeta, null);
  assert.equal(
    buildLocalRecoveryExportFilename(new Date('2026-08-28T01:02:03.456Z')),
    'compound-local-recovery-2026-08-28T01-02-03-456Z.json',
  );
});

test('real Dexie-shaped recovery exports read every table in one transaction', async () => {
  let transactionCalls = 0;
  const table = { toArray: async () => [] };
  const database = {
    sources: table,
    concepts: table,
    activity: table,
    askHistory: table,
    syncMeta: { get: async () => undefined },
    transaction: async (mode: string, tables: unknown[], scope: () => Promise<unknown>) => {
      transactionCalls += 1;
      assert.equal(mode, 'r');
      assert.equal(tables.length, 5);
      return scope();
    },
  } as unknown as LocalRecoveryDatabase;

  await exportLocalRecoverySnapshot(database, 2);
  assert.equal(transactionCalls, 1);
});
