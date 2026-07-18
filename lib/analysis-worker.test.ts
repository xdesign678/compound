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

async function withMockFetch<T>(mockFetch: typeof fetch, fn: () => Promise<T> | T): Promise<T> {
  const previous = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = previous;
  }
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
    .prepare(`SELECT status, attempts, error, dead_letter_at FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as {
    status: string;
    attempts: number;
    error: string;
    dead_letter_at: number | null;
  };
  const item = getServerDb()
    .prepare(`SELECT status, stage, error FROM sync_run_items WHERE id = ?`)
    .get('sri-invalid-payload') as { status: string; stage: string; error: string };
  const dashboard = syncObs.getDashboard();
  const retried = retryAnalysisJobs({ itemId: 'sri-invalid-payload' });

  assert.equal(result.claimed, 1);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 3);
  assert.ok(job.dead_letter_at);
  assert.match(job.error, /缺少文件内容/);
  assert.equal(item.status, 'failed');
  assert.equal(item.stage, 'llm');
  assert.match(item.error, /缺少文件内容/);
  assert.equal(dashboard.dlq.count, 1);
  assert.equal(dashboard.dlq.byStage.github_ingest, 1);
  assert.equal(dashboard.dlq.recent[0]?.id, jobId);
  assert.equal(retried, 0);
});

test('post-ingest jobs keep the file running until every enhancement stage is terminal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-enhance',
    title: 'Enhance',
    type: 'file',
    rawContent: '# Enhance\n\nBody',
    ingestedAt: Date.now(),
    externalKey: 'github:demo/vault:notes/enhance.md@sha-enhance',
  });
  syncObs.startRun({
    id: 'sr-enhance',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-enhance',
    runId: 'sr-enhance',
    path: 'notes/enhance.md',
    changeType: 'update',
    status: 'running',
    stage: 'enhance',
    sourceId: 's-enhance',
  });
  queueAdvancedAnalysisJob({
    runId: 'sr-enhance',
    itemId: 'sri-enhance',
    sourceId: 's-enhance',
    sourceSha: 'sha-enhance',
    sourcePath: 'notes/enhance.md',
    stage: 'chunk',
  });
  queueAdvancedAnalysisJob({
    runId: 'sr-enhance',
    itemId: 'sri-enhance',
    sourceId: 's-enhance',
    sourceSha: 'sha-enhance',
    sourcePath: 'notes/enhance.md',
    stage: 'qa_index',
  });

  await runAnalysisWorkerOnce();
  const midItem = getServerDb()
    .prepare(`SELECT status, stage, finished_at FROM sync_run_items WHERE id = ?`)
    .get('sri-enhance') as { status: string; stage: string; finished_at: number | null };

  await runAnalysisWorkerOnce();
  const doneItem = getServerDb()
    .prepare(`SELECT status, stage, finished_at FROM sync_run_items WHERE id = ?`)
    .get('sri-enhance') as { status: string; stage: string; finished_at: number | null };

  assert.equal(midItem.status, 'running');
  assert.equal(midItem.stage, 'enhance');
  assert.equal(midItem.finished_at, null);
  assert.equal(doneItem.status, 'succeeded');
  assert.equal(doneItem.stage, 'complete');
  assert.ok(doneItem.finished_at);
});

test('enhancement failure keeps an ingested file usable and records a warning', async (t) => {
  const env = setupTempDb();
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ['LLM_API_KEY', 'LLM_API_URL', 'COMPOUND_SKIP_DNS_GUARD']) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_API_URL = 'https://example.com/v1/chat/completions';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  t.after(() => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    env.cleanup();
  });

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');
  const { resetCircuitBreakersForTests } = await import('./circuit-breaker');
  resetCircuitBreakersForTests();

  repo.insertSource({
    id: 's-degraded',
    title: 'Degraded enhancement',
    type: 'file',
    rawContent: '# Still usable',
    ingestedAt: Date.now(),
  });
  syncObs.startRun({
    id: 'sr-degraded',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-degraded',
    runId: 'sr-degraded',
    path: 'notes/degraded.md',
    changeType: 'create',
    status: 'running',
    stage: 'enhance',
    sourceId: 's-degraded',
  });
  queueAdvancedAnalysisJob({
    runId: 'sr-degraded',
    itemId: 'sri-degraded',
    sourceId: 's-degraded',
    sourceSha: 'sha-degraded',
    sourcePath: 'notes/degraded.md',
    stage: 'summarize',
    maxAttempts: 1,
  });

  await withMockFetch(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not valid json' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    () => runAnalysisWorkerOnce({ stages: ['summarize'] }),
  );

  const item = getServerDb()
    .prepare(`SELECT status, stage, error FROM sync_run_items WHERE id = ?`)
    .get('sri-degraded') as { status: string; stage: string; error: string | null };
  const job = getServerDb()
    .prepare(`SELECT status, dead_letter_at FROM analysis_jobs WHERE item_id = ?`)
    .get('sri-degraded') as { status: string; dead_letter_at: number | null };
  const warning = getServerDb()
    .prepare(
      `SELECT level, message
       FROM sync_events
       WHERE item_id = ? AND message LIKE '增强分析部分失败%'
       ORDER BY at DESC
       LIMIT 1`,
    )
    .get('sri-degraded') as { level: string; message: string };

  assert.equal(job.status, 'failed');
  assert.ok(job.dead_letter_at);
  assert.equal(item.status, 'succeeded');
  assert.equal(item.stage, 'complete');
  assert.match(item.error ?? '', /增强分析部分失败/);
  assert.equal(warning.level, 'warn');
  assert.match(warning.message, /可稍后重试/);
  const dashboard = syncObs.getDashboard();
  assert.ok(dashboard.errorStats.some((entry) => /增强分析部分失败/.test(entry.error)));
  assert.ok(dashboard.errorGroups.some((entry) => entry.category === 'enhancement'));
});

test('source enhancement queue prioritizes summary and defers contextualization', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { getAnalysisWorkerPoolStats, queueSourceEnhancementJobs } =
    await import('./analysis-worker');
  queueSourceEnhancementJobs({
    sourceId: 's-priority',
    sourceSha: 'sha-priority',
    sourcePath: 'notes/priority.md',
  });

  const jobs = getServerDb()
    .prepare(`SELECT stage, priority FROM analysis_jobs WHERE source_id = ? ORDER BY priority DESC`)
    .all('s-priority') as Array<{ stage: string; priority: number }>;

  assert.deepEqual(jobs, [
    { stage: 'summarize', priority: 50 },
    { stage: 'embedding', priority: 40 },
    { stage: 'relations', priority: 15 },
    { stage: 'contextualize', priority: 5 },
  ]);
  assert.deepEqual(
    getAnalysisWorkerPoolStats().map(({ name, maxWorkers }) => ({ name, maxWorkers })),
    [
      { name: 'github_ingest', maxWorkers: 5 },
      { name: 'post_ingest', maxWorkers: 6 },
    ],
  );
});

test('a delayed retry wakes itself without a dashboard poll', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  const { getServerDb, repo } = await import('./server-db');
  const { clearAnalysisWorkerWakeTimersForTests, queueAdvancedAnalysisJob, startAnalysisWorker } =
    await import('./analysis-worker');
  t.after(() => {
    clearAnalysisWorkerWakeTimersForTests();
    env.cleanup();
  });

  repo.insertSource({
    id: 's-delayed-wake',
    title: 'Delayed wake',
    type: 'file',
    rawContent: '# Delayed wake',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    sourceId: 's-delayed-wake',
    sourcePath: 'delayed.md',
    stage: 'qa_index',
  });
  getServerDb()
    .prepare(`UPDATE analysis_jobs SET not_before_at = ? WHERE id = ?`)
    .run(Date.now() + 60, jobId);

  const start = startAnalysisWorker('delayed-wake-test');
  assert.equal(start.started, false);
  assert.equal(start.reason, 'delayed_queue');

  const deadline = Date.now() + 2_000;
  let status = 'queued';
  while (Date.now() < deadline && ['queued', 'running'].includes(status)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = (
      getServerDb().prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(jobId) as {
        status: string;
      }
    ).status;
  }
  assert.equal(status, 'succeeded');
});

test('same stage and sha can be queued again and skips by fingerprint cache', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-cache',
    title: 'Cache',
    type: 'file',
    rawContent: '# Cache\n\nStable content',
    ingestedAt: Date.now(),
    externalKey: 'github:demo/vault:notes/cache.md@sha-cache',
  });
  for (const runId of ['sr-cache-1', 'sr-cache-2']) {
    syncObs.startRun({
      id: runId,
      kind: 'github',
      triggerType: 'manual',
      repo: 'demo/vault',
      branch: 'main',
    });
    syncObs.upsertRunItem({
      id: `${runId}-item`,
      runId,
      path: 'notes/cache.md',
      changeType: 'update',
      status: 'running',
      stage: 'enhance',
      sourceId: 's-cache',
    });
    queueAdvancedAnalysisJob({
      runId,
      itemId: `${runId}-item`,
      sourceId: 's-cache',
      sourceSha: 'sha-cache',
      sourcePath: 'notes/cache.md',
      stage: 'qa_index',
    });
    await runAnalysisWorkerOnce();
  }

  const job = getServerDb()
    .prepare(`SELECT status, error FROM analysis_jobs WHERE source_id = ? AND stage = ?`)
    .get('s-cache', 'qa_index') as { status: string; error: string | null };
  const secondItem = getServerDb()
    .prepare(`SELECT status FROM sync_run_items WHERE id = ?`)
    .get('sr-cache-2-item') as { status: string };

  assert.equal(job.status, 'skipped');
  assert.equal(job.error, 'stage fingerprint unchanged');
  assert.equal(secondItem.status, 'succeeded');
});

test('github ingest payload stores markdown content by blob reference, not inline payload_json', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob } = await import('./analysis-worker');

  syncObs.startRun({
    id: 'sr-blob',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-blob',
    runId: 'sr-blob',
    path: 'notes/blob.md',
    changeType: 'create',
    status: 'queued',
    stage: 'ingest',
  });
  const rawContent = '# Blob\n\nThis markdown should not live inside analysis_jobs.payload_json.';
  const jobId = queueGithubIngestJob({
    runId: 'sr-blob',
    itemId: 'sri-blob',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/blob.md',
    sha: 'sha-blob',
    externalKey: 'github:demo/vault:notes/blob.md@sha-blob',
    title: 'Blob',
    rawContent,
  });
  const job = getServerDb()
    .prepare(`SELECT payload_json FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { payload_json: string };
  const payload = JSON.parse(job.payload_json) as {
    rawContent?: string;
    rawContentRef?: string;
    rawContentHash?: string;
  };
  const blob = getServerDb()
    .prepare(`SELECT content, content_hash FROM analysis_payload_blobs WHERE ref = ?`)
    .get(payload.rawContentRef) as { content: string; content_hash: string };

  assert.equal(payload.rawContent, undefined);
  assert.ok(payload.rawContentRef);
  assert.match(payload.rawContentHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(blob.content, rawContent);
  assert.equal(blob.content_hash, payload.rawContentHash);
});

test('claiming a job records a durable heartbeat timestamp', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-heartbeat',
    title: 'Heartbeat',
    type: 'file',
    rawContent: '# Heartbeat',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    sourceId: 's-heartbeat',
    stage: 'qa_index',
  });

  await runAnalysisWorkerOnce();
  const job = getServerDb()
    .prepare(`SELECT status, heartbeat_at, duration_ms FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; heartbeat_at: number | null; duration_ms: number | null };

  assert.equal(job.status, 'succeeded');
  assert.ok(job.heartbeat_at);
  assert.ok(job.duration_ms != null);
});
