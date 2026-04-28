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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-analysis-worker-'));
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

test('github ingest jobs with missing payload fail once and do not requeue', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, retryAnalysisJobs, runAnalysisWorkerOnce } =
    await import('./analysis-worker');

  syncObs.startRun({
    id: 'sr-invalid-payload',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-invalid-payload',
    runId: 'sr-invalid-payload',
    path: 'notes/missing-payload.md',
    changeType: 'create',
    status: 'queued',
    stage: 'ingest',
  });
  const jobId = queueAdvancedAnalysisJob({
    runId: 'sr-invalid-payload',
    itemId: 'sri-invalid-payload',
    sourceId: 'pending:demo/vault:main:notes/missing-payload.md',
    sourcePath: 'notes/missing-payload.md',
    stage: 'github_ingest',
    maxAttempts: 3,
  });

  const result = await runAnalysisWorkerOnce();
  const job = getServerDb()
    .prepare(`SELECT status, attempts, error FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; attempts: number; error: string };
  const item = getServerDb()
    .prepare(`SELECT status, stage, error FROM sync_run_items WHERE id = ?`)
    .get('sri-invalid-payload') as { status: string; stage: string; error: string };
  const retried = retryAnalysisJobs({ itemId: 'sri-invalid-payload' });

  assert.equal(result.claimed, 1);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 3);
  assert.match(job.error, /缺少文件内容/);
  assert.equal(item.status, 'failed');
  assert.equal(item.stage, 'llm');
  assert.match(item.error, /缺少文件内容/);
  assert.equal(retried, 0);
});
