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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-analysis-crash-'));
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

test('a throwing worker tick is swallowed without an unhandled rejection and is recorded', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { ensureAnalysisWorkerSchema, queueAdvancedAnalysisJob, startAnalysisWorker } =
    await import('./analysis-worker');

  ensureAnalysisWorkerSchema();
  repo.insertSource({
    id: 's-crash',
    title: 'Crash',
    type: 'file',
    rawContent: '# Crash',
    ingestedAt: Date.now(),
  });
  queueAdvancedAnalysisJob({ sourceId: 's-crash', stage: 'qa_index' });

  // Launch the worker loop, then yank the table out from under it *before* the
  // async IIFE body runs on the microtask queue. The next DB op inside the loop
  // throws a synchronous better-sqlite3 error (no such table) — the IIFE must
  // catch it and the attached .catch() must keep it off the process.
  const started = startAnalysisWorker('crash-test');
  const g = globalThis as unknown as { __activeAnalysisWorkerPromises?: Set<Promise<void>> };
  const pending = [...(g.__activeAnalysisWorkerPromises ?? [])];
  getServerDb().exec('DROP TABLE analysis_jobs');

  assert.equal(started.started, true);
  assert.ok(pending.length >= 1, 'at least one worker loop should have been launched');

  await Promise.allSettled(pending);
  // Give any stray rejection a couple of turns to surface.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(rejections, [], 'a failing worker tick must not produce an unhandled rejection');

  const crashEvents = getServerDb()
    .prepare(`SELECT meta FROM sync_events WHERE meta LIKE '%analysis.worker_crashed%'`)
    .all() as Array<{ meta: string }>;
  assert.ok(crashEvents.length >= 1, 'the crash should be recorded as analysis.worker_crashed');
  const meta = JSON.parse(crashEvents[0].meta) as { event: string; pool: string };
  assert.equal(meta.event, 'analysis.worker_crashed');
  assert.equal(meta.pool, 'post_ingest');
});
