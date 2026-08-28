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

test(
  'flagConceptIncorrect dedupes open reviews and mirrors activity for a second reader',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { flagConceptIncorrect, findOpenConceptIncorrectReview, listReviewItems } =
      await import('./review-queue');

    const ts = Date.now();
    repo.upsertConcept({
      id: 'c-flag',
      title: '待审概念',
      summary: '',
      body: 'body',
      sources: [],
      related: [],
      categories: [],
      categoryKeys: [],
      createdAt: ts,
      updatedAt: ts,
      version: 1,
    });

    const first = flagConceptIncorrect({
      conceptId: 'c-flag',
      expectedRevision: 1,
      cas: true,
    });
    assert.equal(first.created, true);
    const second = flagConceptIncorrect({
      conceptId: 'c-flag',
      expectedRevision: 1,
      cas: true,
    });
    assert.equal(second.created, false);
    assert.equal(second.review.id, first.review.id);
    assert.equal(second.activity?.id, first.activity?.id);

    const open = listReviewItems({ status: 'open' }).filter(
      (item) => item.kind === 'concept_incorrect' && item.target_id === 'c-flag',
    );
    assert.equal(open.length, 1);
    assert.equal(findOpenConceptIncorrectReview('c-flag')?.id, first.review.id);
    assert.equal(repo.getActivityByIds([first.activity!.id]).length, 1);
  },
);

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

test('reopening a resolved concept flag reuses a newer open flag', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const { flagConceptIncorrect, getReviewItem, reopenReviewItem, resolveReviewItem } =
    await import('./review-queue');
  const ts = Date.now();
  repo.upsertConcept({
    id: 'c-reopen',
    title: '重复标记',
    summary: '',
    body: 'body',
    sources: [],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: ts,
    updatedAt: ts,
    version: 1,
  });

  const first = flagConceptIncorrect({
    conceptId: 'c-reopen',
    expectedRevision: 1,
    cas: true,
  });
  resolveReviewItem(first.review.id, 'resolved');
  const second = flagConceptIncorrect({
    conceptId: 'c-reopen',
    expectedRevision: 1,
    cas: true,
  });

  const reopened = reopenReviewItem(first.review.id, { undo: true });
  assert.equal(reopened?.id, second.review.id);
  assert.equal(getReviewItem(first.review.id)?.status, 'resolved');
  assert.equal(getReviewItem(second.review.id)?.status, 'open');
});
