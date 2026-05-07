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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-github-sync-runner-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    tempDir,
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

test('recoverStaleAnalysisJobs requeues stale running jobs and records lease event', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, recoverStaleAnalysisJobs } = await import('./analysis-worker');
  const staleAt = Date.now() - 11 * 60 * 1000;

  syncObs.startRun({
    id: 'sr-stale-lease',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-stale-lease',
    runId: 'sr-stale-lease',
    path: 'notes/stale.md',
    changeType: 'update',
    status: 'running',
    stage: 'llm',
  });
  getServerDb()
    .prepare(`UPDATE sync_run_items SET updated_at = ? WHERE id = ?`)
    .run(staleAt, 'sri-stale-lease');
  const jobId = queueAdvancedAnalysisJob({
    runId: 'sr-stale-lease',
    itemId: 'sri-stale-lease',
    sourceId: 'pending:demo/vault:main:notes/stale.md',
    sourcePath: 'notes/stale.md',
    stage: 'github_ingest',
  });
  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
         SET status = 'running', locked_at = ?, locked_by = ?, started_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(staleAt, 'dead-worker', staleAt, staleAt, jobId);

  const recovered = recoverStaleAnalysisJobs();
  const job = getServerDb()
    .prepare(
      `SELECT status, attempts, locked_at, locked_by, not_before_at FROM analysis_jobs WHERE id = ?`,
    )
    .get(jobId) as {
    status: string;
    attempts: number;
    locked_at: number | null;
    locked_by: string | null;
    not_before_at: number;
  };
  const item = getServerDb()
    .prepare(`SELECT status, stage, error FROM sync_run_items WHERE id = ?`)
    .get('sri-stale-lease') as { status: string; stage: string; error: string };
  const event = getServerDb()
    .prepare(
      `SELECT meta FROM sync_events
       WHERE json_extract(meta, '$.event') = 'sync.lease_recovered'
       ORDER BY at DESC
       LIMIT 1`,
    )
    .get() as { meta: string } | undefined;

  assert.deepEqual(recovered, { jobs: 1, items: 1 });
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 1);
  assert.equal(job.locked_at, null);
  assert.equal(job.locked_by, null);
  assert.ok(job.not_before_at > staleAt);
  assert.equal(item.status, 'queued');
  assert.equal(item.stage, 'queued');
  assert.match(item.error, /lease expired/);
  assert.ok(event);
  assert.equal(JSON.parse(event.meta).jobs, 1);
});

test('startGithubSync sweeps stale analysis leases before returning existing active job', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob } = await import('./analysis-worker');
  const { startGithubSync } = await import('./github-sync-runner');
  const staleAt = Date.now() - 11 * 60 * 1000;
  closeServerDbGlobal();
  process.env.DATA_DIR = env.tempDir;
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      repo TEXT,
      branch TEXT,
      head_sha TEXT,
      status TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'queued',
      total_files INTEGER NOT NULL DEFAULT 0,
      changed_files INTEGER NOT NULL DEFAULT 0,
      created_files INTEGER NOT NULL DEFAULT 0,
      updated_files INTEGER NOT NULL DEFAULT 0,
      deleted_files INTEGER NOT NULL DEFAULT 0,
      skipped_files INTEGER NOT NULL DEFAULT 0,
      done_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      current TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      heartbeat_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sync_run_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      path TEXT NOT NULL,
      old_sha TEXT,
      new_sha TEXT,
      external_key TEXT,
      source_id TEXT,
      change_type TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      chunks INTEGER,
      concepts_created INTEGER,
      concepts_updated INTEGER,
      evidence INTEGER,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_sha TEXT,
      source_path TEXT,
      stage TEXT NOT NULL,
      stage_version TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_estimate REAL,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL,
      run_id TEXT,
      item_id TEXT,
      payload_json TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      not_before_at INTEGER,
      locked_at INTEGER,
      locked_by TEXT,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      UNIQUE(source_id, source_sha, stage, stage_version, model, prompt_version)
    );
    CREATE TABLE IF NOT EXISTS sync_events (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      item_id TEXT,
      at INTEGER NOT NULL,
      level TEXT NOT NULL,
      stage TEXT,
      path TEXT,
      message TEXT NOT NULL,
      meta TEXT
    );
  `);

  repo.insertSyncJob({
    id: 'job-active',
    kind: 'github',
    status: 'running',
    total: 1,
    done: 0,
    failed: 0,
    current: '分析中',
    log: '[]',
    error: null,
    started_at: Date.now(),
    finished_at: null,
  });
  syncObs.startRun({
    id: 'sr-existing',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-existing',
    runId: 'sr-existing',
    path: 'notes/crashed.md',
    changeType: 'update',
    status: 'running',
    stage: 'llm',
  });
  getServerDb()
    .prepare(`UPDATE sync_run_items SET updated_at = ? WHERE id = ?`)
    .run(staleAt, 'sri-existing');
  const jobId = queueAdvancedAnalysisJob({
    runId: 'sr-existing',
    itemId: 'sri-existing',
    sourceId: 'pending:demo/vault:main:notes/crashed.md',
    sourcePath: 'notes/crashed.md',
    stage: 'github_ingest',
  });
  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
         SET status = 'running', locked_at = ?, locked_by = ?, started_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(staleAt, 'dead-worker', staleAt, staleAt, jobId);

  const result = startGithubSync();
  const job = getServerDb()
    .prepare(`SELECT locked_by FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { locked_by: string | null };

  assert.equal(result.existing, true);
  assert.equal(result.jobId, 'job-active');
  assert.equal(result.recoveredAnalysis, 2);
  assert.notEqual(job.locked_by, 'dead-worker');
});
