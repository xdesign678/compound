import test from 'node:test';
import assert from 'node:assert/strict';

import { LAST_SYNC_CURSOR_KEY, SYNC_META_KEY, SYNC_QUARANTINE_KEY } from './sync-reconciliation';
import { migrateLegacySyncMeta, persistSyncMetaRecord } from './cloud-sync';
import type { SyncMetaRecord } from './offline-outbox';

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function memorySyncMeta() {
  const rows = new Map<string, SyncMetaRecord>();
  return {
    rows,
    syncMeta: {
      async get(id: string) {
        return rows.get(id);
      },
      async put(record: SyncMetaRecord) {
        rows.set(record.id, { ...record });
      },
    },
  };
}

test('legacy localStorage cursor/identity/quarantine migrate once into Dexie syncMeta', async () => {
  const db = memorySyncMeta();
  const storage = new MemoryStorage();
  storage.setItem(LAST_SYNC_CURSOR_KEY, '42');
  storage.setItem(SYNC_META_KEY, JSON.stringify({ datasetId: 'ds-prod', generation: 3 }));
  storage.setItem(
    SYNC_QUARANTINE_KEY,
    JSON.stringify({
      at: 1,
      reason: 'untrusted_forced_full',
      code: 'destructive_reconcile_blocked',
      staleSourceCount: 1,
      staleConceptCount: 0,
      sampleSourceIds: ['s-1'],
      sampleConceptIds: [],
      localCursor: 42,
      remoteCursor: 9,
    }),
  );

  const migrated = await migrateLegacySyncMeta(db, storage);
  assert.equal(migrated.cursor, 42);
  assert.equal(migrated.datasetId, 'ds-prod');
  assert.equal(migrated.generation, 3);
  assert.equal(migrated.quarantine?.staleSourceCount, 1);
  assert.equal(storage.getItem(LAST_SYNC_CURSOR_KEY), null);
  assert.equal(storage.getItem(SYNC_META_KEY), null);
  assert.equal(storage.getItem(SYNC_QUARANTINE_KEY), null);

  storage.setItem(LAST_SYNC_CURSOR_KEY, '99');
  const again = await migrateLegacySyncMeta(db, storage);
  assert.equal(again.cursor, 42);
  assert.equal(again.datasetId, 'ds-prod');
});

test('persistSyncMetaRecord writes cursor and identity in one record', async () => {
  const db = memorySyncMeta();
  await persistSyncMetaRecord(db, {
    id: 'current',
    cursor: 15,
    datasetId: 'ds-prod',
    generation: 1,
  });
  const stored = await db.syncMeta.get('current');
  assert.deepEqual(stored, {
    id: 'current',
    cursor: 15,
    datasetId: 'ds-prod',
    generation: 1,
  });
});
