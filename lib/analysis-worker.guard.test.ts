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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-analysis-guard-'));
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

test('finishJob does not resurrect a job cancelled while in-flight', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, cancelAnalysisJobs, finishJob } =
    await import('./analysis-worker');

  repo.insertSource({
    id: 's-cancel-finish',
    title: 'Cancel/Finish',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    runId: 'run-cancel-finish',
    itemId: 'item-cancel-finish',
    sourceId: 's-cancel-finish',
    stage: 'qa_index',
  });

  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w-test' WHERE id = ?`,
  ).run(ts, ts, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof finishJob
  >[0];

  cancelAnalysisJobs({ runId: 'run-cancel-finish' });

  finishJob(job, 'succeeded');

  const after = db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    status: string;
  };
  assert.equal(after.status, 'cancelled');
});

test('stale worker cannot finish a job after a newer lease takes ownership', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, finishJob } = await import('./analysis-worker');
  repo.insertSource({
    id: 's-fenced',
    title: 'Fenced',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-fenced', stage: 'qa_index' });
  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'worker-old', lease_version = 1
      WHERE id = ?`,
  ).run(ts, ts, jobId);
  const staleJob = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof finishJob
  >[0];

  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', locked_at = ?, locked_by = 'worker-new', lease_version = 2
      WHERE id = ?`,
  ).run(ts + 1, jobId);
  finishJob(staleJob, 'succeeded');

  const stillOwned = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.deepEqual(stillOwned, {
    status: 'running',
    locked_by: 'worker-new',
    lease_version: 2,
  });

  const currentJob = db
    .prepare(`SELECT * FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as Parameters<typeof finishJob>[0];
  finishJob(currentJob, 'succeeded');
  const finished = db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    status: string;
  };
  assert.equal(finished.status, 'succeeded');
});

test('failJob does not requeue a job cancelled while in-flight', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, cancelAnalysisJobs, failJob } =
    await import('./analysis-worker');

  repo.insertSource({
    id: 's-cancel-fail',
    title: 'Cancel/Fail',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    runId: 'run-cancel-fail',
    itemId: 'item-cancel-fail',
    sourceId: 's-cancel-fail',
    stage: 'qa_index',
  });

  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w-test' WHERE id = ?`,
  ).run(ts, ts, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof failJob
  >[0];

  cancelAnalysisJobs({ runId: 'run-cancel-fail' });

  failJob(job, new Error('transient boom'));

  const after = db
    .prepare(`SELECT status, dead_letter_at FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; dead_letter_at: number | null };
  assert.equal(after.status, 'cancelled');
  assert.equal(after.dead_letter_at, null);
});

test('failJobPermanently does not dead-letter a job cancelled while in-flight', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, cancelAnalysisJobs, failJobPermanently } =
    await import('./analysis-worker');

  repo.insertSource({
    id: 's-cancel-permanent',
    title: 'Cancel/Permanent',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    runId: 'run-cancel-permanent',
    itemId: 'item-cancel-permanent',
    sourceId: 's-cancel-permanent',
    stage: 'github_ingest',
  });

  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w-test' WHERE id = ?`,
  ).run(ts, ts, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof failJobPermanently
  >[0];

  cancelAnalysisJobs({ runId: 'run-cancel-permanent' });

  failJobPermanently(job, 'GitHub 分析任务缺少文件内容，请重新同步该文件。');

  const after = db
    .prepare(`SELECT status, dead_letter_at, error_category FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; dead_letter_at: number | null; error_category: string | null };
  assert.equal(after.status, 'cancelled');
  assert.equal(after.dead_letter_at, null);
});

test('failJobPermanently dead-letters a genuinely running job', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, failJobPermanently } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-running-permanent',
    title: 'Running/Permanent',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    runId: 'run-running-permanent',
    itemId: 'item-running-permanent',
    sourceId: 's-running-permanent',
    stage: 'github_ingest',
  });

  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w-test' WHERE id = ?`,
  ).run(ts, ts, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof failJobPermanently
  >[0];

  failJobPermanently(job, 'GitHub 分析任务缺少文件内容，请重新同步该文件。');

  const after = db
    .prepare(`SELECT status, dead_letter_at, error_category FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; dead_letter_at: number | null; error_category: string | null };
  assert.equal(after.status, 'failed');
  assert.ok(after.dead_letter_at, 'dead_letter_at should be set');
  assert.equal(after.error_category, 'permanent');
});

test('recoverStaleAnalysisJobs dead-letters a stale running job at the attempt ceiling', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, recoverStaleAnalysisJobs } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-poison',
    title: 'Poison',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    sourceId: 's-poison',
    stage: 'qa_index',
    maxAttempts: 3,
  });

  const db = getServerDb();
  const stale = Date.now() - 60 * 60 * 1000;
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', attempts = 3, max_attempts = 3, started_at = ?, locked_at = ?, updated_at = ? WHERE id = ?`,
  ).run(stale, stale, stale, jobId);

  const result = recoverStaleAnalysisJobs();

  const after = db
    .prepare(`SELECT status, dead_letter_at FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; dead_letter_at: number | null };
  assert.ok(after.dead_letter_at, 'dead_letter_at should be set');
  assert.ok(
    after.status !== 'queued' && after.status !== 'running',
    `status should be terminal, got ${after.status}`,
  );
  assert.equal(result.jobs, 1);
});

test('recoverStaleAnalysisJobs requeues a stale running job below the attempt ceiling', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, recoverStaleAnalysisJobs } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-stale-requeue',
    title: 'Requeue',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    sourceId: 's-stale-requeue',
    stage: 'qa_index',
    maxAttempts: 3,
  });

  const db = getServerDb();
  const stale = Date.now() - 60 * 60 * 1000;
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', attempts = 0, max_attempts = 3, started_at = ?, locked_at = ?, updated_at = ? WHERE id = ?`,
  ).run(stale, stale, stale, jobId);

  const result = recoverStaleAnalysisJobs();

  const after = db
    .prepare(`SELECT status, dead_letter_at, attempts FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; dead_letter_at: number | null; attempts: number };
  assert.equal(after.status, 'queued');
  assert.equal(after.dead_letter_at, null);
  assert.equal(after.attempts, 1);
  assert.equal(result.jobs, 1);
});
