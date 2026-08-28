import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

test(
  'derived-draft reject after approve is idempotent and does not re-apply',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft } = await import('./query-provenance');
    const { resolveReviewItem, getReviewItem } = await import('./review-queue');

    const ts = Date.now();
    repo.insertSource({
      id: 's-race',
      title: 'Race',
      type: 'text',
      rawContent: '# Race\n\nRace notes for review claim tests.',
      ingestedAt: ts,
    });
    repo.upsertConcept({
      id: 'c-race-src',
      title: 'Race source concept',
      summary: 'Race notes',
      body: 'Race notes for review claim tests.',
      sources: ['s-race'],
      related: [],
      categories: [],
      categoryKeys: [],
      createdAt: ts,
      updatedAt: ts,
      version: 1,
    });
    wikiRepo.rebuildAllIndexes();
    const archived = archiveAnswerAsDraft({
      title: 'Race 综述',
      summary: '综合 Race',
      body: 'Race notes for review claim tests.',
      citedConceptIds: ['c-race-src'],
    });

    const approved = resolveReviewItem(archived.reviewId, 'approved');
    assert.equal(approved?.status, 'approved');
    assert.equal(repo.getConcept(archived.conceptId)?.knowledgeStatus, 'approved');

    const second = resolveReviewItem(archived.reviewId, 'rejected');
    assert.equal(second?.status, 'approved');
    assert.equal(repo.getConcept(archived.conceptId)?.knowledgeStatus, 'approved');
    assert.equal(getReviewItem(archived.reviewId)?.status, 'approved');
    assert.equal(
      Number(
        (
          getServerDb()
            .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
            .get(archived.conceptId) as { n: number }
        ).n,
      ),
      1,
    );
  },
);

test(
  'approve vs reject race on two connections applies at most one outcome',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft } = await import('./query-provenance');
    const { resolveReviewItem, getReviewItem } = await import('./review-queue');
    const { Worker } = await import('node:worker_threads');

    const ts = Date.now();
    repo.insertSource({
      id: 's-conn',
      title: 'Conn',
      type: 'text',
      rawContent: '# Conn\n\nTwo-connection review claim race.',
      ingestedAt: ts,
    });
    repo.upsertConcept({
      id: 'c-conn-src',
      title: 'Conn source concept',
      summary: 'Conn notes',
      body: 'Two-connection review claim race.',
      sources: ['s-conn'],
      related: [],
      categories: [],
      categoryKeys: [],
      createdAt: ts,
      updatedAt: ts,
      version: 1,
    });
    wikiRepo.rebuildAllIndexes();
    const archived = archiveAnswerAsDraft({
      title: 'Conn 综述',
      summary: '综合 Conn',
      body: 'Two-connection review claim race.',
      citedConceptIds: ['c-conn-src'],
    });

    const reviewQueuePath = [
      path.join(process.cwd(), 'node_modules/.cache/compound-node-tests/lib/review-queue.js'),
      path.join(
        process.cwd(),
        'node_modules/.cache/compound-node-tests-focused/lib/review-queue.js',
      ),
    ].find((candidate) => existsSync(candidate));
    assert.ok(reviewQueuePath, 'compiled review-queue.js must exist for the two-connection race');
    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        process.env.DATA_DIR = workerData.dataDir;
        delete global.__compound_sqlite__;
        const { resolveReviewItem } = require(workerData.reviewQueuePath);
        try {
          const item = resolveReviewItem(workerData.reviewId, workerData.status);
          parentPort.postMessage({ ok: true, status: item && item.status });
        } catch (err) {
          parentPort.postMessage({ ok: false, error: String(err) });
        }
      `,
      {
        eval: true,
        workerData: {
          dataDir: process.env.DATA_DIR,
          reviewQueuePath,
          reviewId: archived.reviewId,
          status: 'rejected',
        },
      },
    );

    const workerResult = new Promise<{ ok: boolean; status?: string; error?: string }>(
      (resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`worker exited ${code}`));
        });
      },
    );

    const parent = resolveReviewItem(archived.reviewId, 'approved');
    const child = await workerResult;
    await worker.terminate();

    const finalReview = getReviewItem(archived.reviewId);
    const finalConcept = repo.getConcept(archived.conceptId);
    assert.ok(finalReview);
    assert.ok(finalReview!.status === 'approved' || finalReview!.status === 'rejected');
    assert.equal(
      finalConcept?.knowledgeStatus,
      finalReview!.status === 'approved' ? 'approved' : 'rejected',
    );
    assert.ok(parent?.status === 'approved' || parent?.status === 'rejected');
    if (child.ok) {
      assert.equal(child.status, finalReview!.status);
    }
  },
);
