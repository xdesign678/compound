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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-blob-cleanup-'));
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

// ---------------------------------------------------------------------------
// Change 2: failJob / failJobPermanently early-return blob cleanup
// ---------------------------------------------------------------------------

test('failJob deletes github ingest payload blob even when job is no longer running (cancelled)', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { ensureAnalysisWorkerSchema, queueGithubIngestJob, cancelAnalysisJobs, failJob } =
    await import('./analysis-worker');

  ensureAnalysisWorkerSchema();
  const db = getServerDb();

  repo.insertSource({
    id: 's-blob-cancel-fail',
    title: 'Blob/Cancel/Fail',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });

  // Create a github_ingest job with a payload blob
  const payload = {
    runId: 'run-blob-cancel-fail',
    itemId: 'item-blob-cancel-fail',
    repoSlug: 'test/repo',
    branch: 'main',
    path: 'test.md',
    sha: 'abc123',
    externalKey: 'ext-key-bcf',
    title: 'Test',
    rawContent: 'test content for blob',
    rawContentHash: 'hash123',
  };
  const jobId = queueGithubIngestJob(payload);

  // Verify the blob was created
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof failJob
  >[0];

  // Mark it as running
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w-test' WHERE id = ?`,
  ).run(ts, ts, jobId);

  // Read the updated job row
  const runningJob = db
    .prepare(`SELECT * FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as Parameters<typeof failJob>[0];

  // Verify blob exists (count all blobs — the queueGithubIngestJob should have created one)
  const blobCountBefore = Number(
    (db.prepare(`SELECT COUNT(*) AS cnt FROM analysis_payload_blobs`).get() as { cnt: number }).cnt,
  );
  assert.ok(blobCountBefore >= 1, 'at least one payload blob should exist');

  // Cancel the run — job status becomes 'cancelled'
  cancelAnalysisJobs({ runId: 'run-blob-cancel-fail' });

  // Verify job is cancelled
  const cancelledJob = db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    status: string;
  };
  assert.equal(cancelledJob.status, 'cancelled');

  // Now call failJob with the stale running job snapshot
  failJob(runningJob, new Error('transient error'));

  // Job should remain cancelled (guard blocked the update)
  const afterJob = db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    status: string;
  };
  assert.equal(afterJob.status, 'cancelled');

  // But the blob should have been cleaned up (best-effort in early-return path)
  const blobCountAfter = Number(
    (db.prepare(`SELECT COUNT(*) AS cnt FROM analysis_payload_blobs`).get() as { cnt: number }).cnt,
  );
  assert.ok(
    blobCountAfter < blobCountBefore,
    'payload blob should be deleted even when job was already cancelled',
  );
});

test('failJobPermanently deletes github ingest payload blob even when job is no longer running (cancelled)', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const {
    ensureAnalysisWorkerSchema,
    queueGithubIngestJob,
    cancelAnalysisJobs,
    failJobPermanently,
  } = await import('./analysis-worker');

  ensureAnalysisWorkerSchema();
  const db = getServerDb();

  repo.insertSource({
    id: 's-blob-cancel-perm',
    title: 'Blob/Cancel/Permanent',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });

  // Create a github_ingest job with a payload blob
  const payload = {
    runId: 'run-blob-cancel-perm',
    itemId: 'item-blob-cancel-perm',
    repoSlug: 'test/repo2',
    branch: 'main',
    path: 'test2.md',
    sha: 'def456',
    externalKey: 'ext-key-bcp',
    title: 'Test2',
    rawContent: 'test content for blob permanent',
    rawContentHash: 'hash456',
  };
  const jobId = queueGithubIngestJob(payload);

  // Mark it as running
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w-test2' WHERE id = ?`,
  ).run(ts, ts, jobId);

  const runningJob = db
    .prepare(`SELECT * FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as Parameters<typeof failJobPermanently>[0];

  // Verify blob exists
  const blobCountBefore = Number(
    (db.prepare(`SELECT COUNT(*) AS cnt FROM analysis_payload_blobs`).get() as { cnt: number }).cnt,
  );
  assert.ok(blobCountBefore >= 1, 'at least one payload blob should exist');

  // Cancel the run
  cancelAnalysisJobs({ runId: 'run-blob-cancel-perm' });

  // Call failJobPermanently with the stale running job snapshot
  const result = failJobPermanently(runningJob, 'permanent failure');
  assert.equal(result, false, 'should return false since job was no longer running');

  // Job should remain cancelled
  const afterJob = db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    status: string;
  };
  assert.equal(afterJob.status, 'cancelled');

  // But the blob should have been cleaned up
  const blobCountAfter = Number(
    (db.prepare(`SELECT COUNT(*) AS cnt FROM analysis_payload_blobs`).get() as { cnt: number }).cnt,
  );
  assert.ok(
    blobCountAfter < blobCountBefore,
    'payload blob should be deleted even when failJobPermanently early-returned',
  );
});

test('failJob deletes blob in normal path when job is still running', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { ensureAnalysisWorkerSchema, queueGithubIngestJob, failJob } =
    await import('./analysis-worker');

  ensureAnalysisWorkerSchema();
  const db = getServerDb();

  repo.insertSource({
    id: 's-blob-running-fail',
    title: 'Blob/Running/Fail',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });

  const payload = {
    runId: 'run-blob-running-fail',
    itemId: 'item-blob-running-fail',
    repoSlug: 'test/repo3',
    branch: 'main',
    path: 'test3.md',
    sha: 'ghi789',
    externalKey: 'ext-key-brf',
    title: 'Test3',
    rawContent: 'test content for running fail',
    rawContentHash: 'hash789',
  };
  const jobId = queueGithubIngestJob(payload);

  // Mark it as running with exhausted attempts so failJob marks it terminal
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', attempts = 3, max_attempts = 3, started_at = ?, locked_at = ?, locked_by = 'w-test3' WHERE id = ?`,
  ).run(ts, ts, jobId);

  const runningJob = db
    .prepare(`SELECT * FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as Parameters<typeof failJob>[0];

  const blobCountBefore = Number(
    (db.prepare(`SELECT COUNT(*) AS cnt FROM analysis_payload_blobs`).get() as { cnt: number }).cnt,
  );
  assert.ok(blobCountBefore >= 1);

  // Call failJob — job IS still running, so the normal path should apply
  failJob(runningJob, new Error('permanent error'));

  // Job should be failed
  const afterJob = db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    status: string;
  };
  assert.equal(afterJob.status, 'failed');

  // Blob should be cleaned up (normal path)
  const blobCountAfter = Number(
    (db.prepare(`SELECT COUNT(*) AS cnt FROM analysis_payload_blobs`).get() as { cnt: number }).cnt,
  );
  assert.ok(
    blobCountAfter < blobCountBefore,
    'payload blob should be deleted via normal path when job was still running',
  );
});
