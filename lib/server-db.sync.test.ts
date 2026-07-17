import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-sync-change-log-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('sync change log converges source edits and deletes with a monotonic cursor', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const ingestedAt = Date.now();
  repo.insertSource({
    id: 's-1',
    title: '初始标题',
    type: 'file',
    rawContent: '初始正文',
    ingestedAt,
  });
  repo.upsertConcept({
    id: 'c-1',
    title: '概念',
    summary: '摘要',
    body: '正文',
    sources: ['s-1'],
    related: [],
    createdAt: ingestedAt,
    updatedAt: ingestedAt,
    version: 1,
    categories: [],
    categoryKeys: [],
  });

  const initialCursor = repo.getLatestSyncCursor();
  const initialIds = repo.listEntityIdsAtSyncCursor('source', initialCursor, {
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(initialIds, ['s-1']);

  repo.insertSource({
    id: 's-1',
    title: '更新标题',
    type: 'file',
    rawContent: '更新正文',
    ingestedAt,
    updatedAt: ingestedAt,
  });
  const edited = repo.getSource('s-1');
  assert.equal(edited?.title, '更新标题');
  assert.ok((edited?.updatedAt ?? 0) > ingestedAt);

  const editCursor = repo.getLatestSyncCursor();
  const editChanges = repo.listSyncChanges({
    after: initialCursor,
    before: editCursor,
    limit: 10,
  });
  assert.deepEqual(
    editChanges.map((change) => [change.entityType, change.entityId, change.operation]),
    [['source', 's-1', 'upsert']],
  );

  repo.deleteSource('s-1');
  assert.equal(repo.getSource('s-1'), null);
  const concept = repo.getConcept('c-1');
  assert.deepEqual(concept?.sources, []);
  assert.equal(concept?.version, 2);

  const deleteCursor = repo.getLatestSyncCursor();
  const deleteChanges = repo.listSyncChanges({
    after: editCursor,
    before: deleteCursor,
    limit: 10,
  });
  assert.deepEqual(
    deleteChanges.map((change) => [change.entityType, change.entityId, change.operation]),
    [
      ['concept', 'c-1', 'upsert'],
      ['source', 's-1', 'delete'],
    ],
  );
  assert.deepEqual(
    repo.listEntityIdsAtSyncCursor('source', initialCursor, { limit: 10, offset: 0 }),
    ['s-1'],
  );
  assert.deepEqual(
    repo.listEntityIdsAtSyncCursor('source', deleteCursor, { limit: 10, offset: 0 }),
    [],
  );
});
