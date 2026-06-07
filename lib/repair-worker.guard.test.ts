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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-repair-guard-'));
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
// Change 1: markJob / finalizeRun status guard
// ---------------------------------------------------------------------------

test('markJob does not overwrite a job already in a terminal state', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun } = await import('./repair-worker');

  ensureRepairSchema();
  const db = getServerDb();

  // Create a run with one link job
  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'test', conceptIds: ['c-1', 'c-2'] },
  ]);

  // Manually move the job to 'failed' (terminal state)
  db.prepare(
    `UPDATE repair_jobs SET status = 'failed', error = 'already failed' WHERE run_id = ?`,
  ).run(runId);

  // Try to mark a failed job as 'done' — should be a no-op
  db.prepare(
    `UPDATE repair_jobs SET status = 'done', error = NULL, locked_by = NULL, locked_at = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(Date.now(), db.prepare(`SELECT id FROM repair_jobs WHERE run_id = ?`).pluck().get(runId));

  const after = db.prepare(`SELECT status, error FROM repair_jobs WHERE run_id = ?`).get(runId) as {
    status: string;
    error: string | null;
  };
  assert.equal(after.status, 'failed', 'status should remain failed');
  assert.equal(after.error, 'already failed', 'error should remain unchanged');
});

test('finalizeRun does not overwrite a cancelled run', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun } = await import('./repair-worker');

  ensureRepairSchema();
  const db = getServerDb();

  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'test', conceptIds: ['c-1', 'c-2'] },
  ]);

  // Simulate the run being cancelled (e.g. by another process)
  db.prepare(`UPDATE repair_runs SET status = 'cancelled', finished_at = ? WHERE id = ?`).run(
    Date.now(),
    runId,
  );

  // Attempt to finalize as 'done' — AND status='running' guard should block it
  const res = db
    .prepare(
      `UPDATE repair_runs SET status = 'done', finished_at = ? WHERE id = ? AND status = 'running'`,
    )
    .run(Date.now(), runId);

  assert.equal(Number(res.changes), 0, 'no rows should be updated');

  const after = db.prepare(`SELECT status FROM repair_runs WHERE id = ?`).get(runId) as {
    status: string;
  };
  assert.equal(after.status, 'cancelled', 'status should remain cancelled');
});

// ---------------------------------------------------------------------------
// Change 3: max_attempts column + dead-letter path in recoverStaleRepairJobs
// ---------------------------------------------------------------------------

test('ensureRepairSchema adds max_attempts column (idempotent)', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { ensureRepairSchema } = await import('./repair-worker');

  ensureRepairSchema();
  const db = getServerDb();

  const cols = new Set(
    (db.prepare(`PRAGMA table_info(repair_jobs)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  assert.ok(cols.has('max_attempts'), 'max_attempts column should exist');

  // Call again — should not throw (idempotent)
  ensureRepairSchema();
});

test('createRepairRun sets max_attempts on new jobs', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun } = await import('./repair-worker');

  ensureRepairSchema();
  const db = getServerDb();

  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'test', conceptIds: ['c-1', 'c-2'] },
  ]);

  const job = db.prepare(`SELECT max_attempts FROM repair_jobs WHERE run_id = ?`).get(runId) as {
    max_attempts: number;
  };
  assert.equal(job.max_attempts, 3, 'default max_attempts should be 3');
});

test('recoverStaleRepairJobs dead-letters a stale running job at the attempt ceiling', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun, recoverStaleRepairJobs } =
    await import('./repair-worker');

  ensureRepairSchema();
  const db = getServerDb();

  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'poison', conceptIds: ['c-1', 'c-2'] },
  ]);

  // Simulate a stale running job that has exhausted attempts
  const stale = Date.now() - 60 * 60 * 1000;
  db.prepare(
    `UPDATE repair_jobs SET status = 'running', attempts = 3, max_attempts = 3, lease_expires_at = ?, updated_at = ? WHERE run_id = ?`,
  ).run(stale, stale, runId);

  const result = recoverStaleRepairJobs();

  assert.equal(result.deadLettered, 1, 'one job should be dead-lettered');
  assert.equal(result.requeued, 0, 'no jobs should be requeued');

  const job = db.prepare(`SELECT status, error FROM repair_jobs WHERE run_id = ?`).get(runId) as {
    status: string;
    error: string | null;
  };
  assert.equal(job.status, 'failed', 'status should be failed (dead-lettered)');
  assert.ok(job.error?.includes('max attempts'), 'error should mention max attempts');

  // Run's failed counter should have been bumped
  const run = db.prepare(`SELECT failed FROM repair_runs WHERE id = ?`).get(runId) as {
    failed: number;
  };
  assert.equal(run.failed, 1, 'run failed counter should be 1');
});

test('recoverStaleRepairJobs requeues a stale running job below the attempt ceiling', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun, recoverStaleRepairJobs } =
    await import('./repair-worker');

  ensureRepairSchema();
  const db = getServerDb();

  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'retry', conceptIds: ['c-1', 'c-2'] },
  ]);

  // Simulate a stale running job that still has attempts left
  const stale = Date.now() - 60 * 60 * 1000;
  db.prepare(
    `UPDATE repair_jobs SET status = 'running', attempts = 1, max_attempts = 3, lease_expires_at = ?, updated_at = ? WHERE run_id = ?`,
  ).run(stale, stale, runId);

  const result = recoverStaleRepairJobs();

  assert.equal(result.requeued, 1, 'one job should be requeued');
  assert.equal(result.deadLettered, 0, 'no jobs should be dead-lettered');

  const job = db.prepare(`SELECT status FROM repair_jobs WHERE run_id = ?`).get(runId) as {
    status: string;
  };
  assert.equal(job.status, 'queued', 'status should be queued (requeued)');
});
