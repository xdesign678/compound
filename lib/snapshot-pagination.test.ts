import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fullSnapshotHasMore, readFourTableTotals } from './sync-reconciliation';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

test('fullSnapshotHasMore uses the max of four table totals', () => {
  assert.equal(
    fullSnapshotHasMore({
      offset: 0,
      limit: 1000,
      totalSources: 10,
      totalConcepts: 10,
      totalActivity: 1500,
      totalAsk: 10,
    }),
    true,
  );
  assert.equal(
    fullSnapshotHasMore({
      offset: 1000,
      limit: 1000,
      totalSources: 10,
      totalConcepts: 10,
      totalActivity: 1500,
      totalAsk: 10,
    }),
    false,
  );
  assert.equal(
    fullSnapshotHasMore({
      offset: 0,
      limit: 500,
      totalSources: 1,
      totalConcepts: 1,
      totalActivity: 1,
      totalAsk: 501,
    }),
    true,
  );
  assert.equal(
    readFourTableTotals({
      limit: 10,
      offset: 0,
      totalSources: 1,
      totalConcepts: 1,
    }),
    null,
  );
});

test(
  'activity and ask ids paginate past the old 1000/500 first-page caps',
  { concurrency: false },
  async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-snapshot-page-'));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = tempDir;
    closeServerDbGlobal();
    try {
      const { repo, getServerDb } = await import('./server-db');
      const now = Date.now();
      for (let index = 0; index < 1001; index += 1) {
        repo.insertActivity({
          id: `a-${index}`,
          type: 'ingest',
          title: `log-${index}`,
          details: '',
          at: now + index,
        });
      }
      const db = getServerDb();
      const insertAsk = db.prepare(
        `INSERT INTO ask_history(id, role, text, cited_concepts, at) VALUES (?, 'user', ?, '[]', ?)`,
      );
      const insertChange = db.prepare(
        `INSERT INTO sync_changes(entity_type, entity_id, operation, changed_at) VALUES ('ask', ?, 'upsert', ?)`,
      );
      for (let index = 0; index < 501; index += 1) {
        insertAsk.run(`q-${index}`, `question ${index}`, now + index);
        insertChange.run(`q-${index}`, now + index);
      }

      const cursor = repo.getLatestSyncCursor();
      assert.equal(repo.countEntityIdsAtSyncCursor('activity', cursor), 1001);
      assert.equal(repo.countEntityIdsAtSyncCursor('ask', cursor), 501);

      const activityPage0 = repo.listEntityIdsAtSyncCursor('activity', cursor, {
        limit: 1000,
        offset: 0,
      });
      const activityPage1 = repo.listEntityIdsAtSyncCursor('activity', cursor, {
        limit: 1000,
        offset: 1000,
      });
      assert.equal(activityPage0.length, 1000);
      assert.equal(activityPage1.length, 1);
      assert.equal(new Set([...activityPage0, ...activityPage1]).size, 1001);

      const askPage0 = repo.listEntityIdsAtSyncCursor('ask', cursor, { limit: 500, offset: 0 });
      const askPage1 = repo.listEntityIdsAtSyncCursor('ask', cursor, { limit: 500, offset: 500 });
      assert.equal(askPage0.length, 500);
      assert.equal(askPage1.length, 1);
      assert.equal(new Set([...askPage0, ...askPage1]).size, 501);
    } finally {
      closeServerDbGlobal();
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
