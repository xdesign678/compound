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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-review-queue-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('reopenReviewItem moves a resolved item back to the open queue', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const {
    createReviewItem,
    getReviewMetrics,
    listReviewItems,
    reopenReviewItem,
    resolveReviewItem,
  } = await import('./review-queue');
  const id = createReviewItem({
    kind: 'manual',
    title: 'Needs another look',
    targetType: 'source',
    targetId: 'source-1',
    payload: { reason: 'test' },
  });

  const resolved = resolveReviewItem(id, 'resolved', { note: 'handled' });
  assert.equal(resolved?.status, 'resolved');
  assert.equal(getReviewMetrics().reviewOpen, 0);

  const reopened = reopenReviewItem(id, { undo: true });
  assert.equal(reopened?.status, 'open');
  assert.equal(getReviewMetrics().reviewOpen, 1);
  assert.deepEqual(
    listReviewItems({ status: 'open' }).map((item) => item.id),
    [id],
  );
});
