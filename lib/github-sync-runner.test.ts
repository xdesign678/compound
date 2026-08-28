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

async function waitForAnalysisWorkers(): Promise<void> {
  const holder = globalThis as unknown as {
    __activeAnalysisWorkerPromises?: Set<Promise<void>>;
  };
  const promises = Array.from(holder.__activeAnalysisWorkerPromises ?? []);
  if (promises.length > 0) {
    await Promise.allSettled(promises);
  }
}

async function waitForSyncLoops(): Promise<void> {
  const holder = globalThis as unknown as {
    __activeSyncPromises?: Set<Promise<void>>;
  };
  for (let i = 0; i < 40; i += 1) {
    const promises = Array.from(holder.__activeSyncPromises ?? []);
    if (promises.length === 0) return;
    await Promise.allSettled(promises);
  }
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
  await waitForAnalysisWorkers();
  const job = getServerDb()
    .prepare(`SELECT locked_by FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { locked_by: string | null };

  assert.equal(result.existing, true);
  assert.equal(result.jobId, 'job-active');
  assert.equal(result.recoveredAnalysis, 2);
  assert.notEqual(job.locked_by, 'dead-worker');
});

test(
  'startGithubSyncFromWebhook records delivery and deduplicates retries',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { getServerDb, repo } = await import('./server-db');
    const { fingerprintWebhookSignature } = await import('./webhook-inbox');
    const { setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => setGithubSyncLoopRunnerForTests(null));
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const first = startGithubSyncFromWebhook({
      deliveryId: 'delivery-1',
      event: 'push',
      signatureSha256: 'sha256=test',
    });
    await waitForSyncLoops();
    const second = startGithubSyncFromWebhook({
      deliveryId: 'delivery-1',
      event: 'push',
      signatureSha256: 'sha256=test',
    });
    await waitForSyncLoops();

    const syncJobs = getServerDb().prepare(`SELECT COUNT(*) AS count FROM sync_jobs`).get() as {
      count: number;
    };
    const delivery = getServerDb()
      .prepare(
        `SELECT delivery_id, status, job_id, error, signature_sha256, attempts, lease_version
           FROM webhook_deliveries WHERE delivery_id = ?`,
      )
      .get('delivery-1') as {
      delivery_id: string;
      status: string;
      job_id: string | null;
      error: string | null;
      signature_sha256: string;
      attempts: number;
      lease_version: number;
    };

    assert.equal(first.existing, false);
    assert.equal(first.workerStarted, true);
    assert.equal(second.existing, true);
    assert.equal(second.workerStarted, false);
    assert.equal(second.jobId, first.jobId);
    assert.equal(syncJobs.count, 1);
    assert.equal(delivery.delivery_id, 'delivery-1');
    assert.equal(delivery.status, 'processed');
    assert.equal(delivery.job_id, first.jobId);
    assert.equal(delivery.error, null);
    assert.equal(delivery.signature_sha256, fingerprintWebhookSignature('sha256=test'));
    assert.notEqual(delivery.signature_sha256, 'sha256=test');
    assert.ok(delivery.attempts >= 1);
    assert.ok(delivery.lease_version >= 1);
  },
);

test(
  'webhook sync uses compare API when local sources match the base commit',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const previousEnv = {
      GITHUB_REPO: process.env.GITHUB_REPO,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_BRANCH: process.env.GITHUB_BRANCH,
    };
    const originalFetch = globalThis.fetch;
    process.env.GITHUB_REPO = 'demo/vault';
    process.env.GITHUB_TOKEN = 'secret';
    process.env.GITHUB_BRANCH = 'main';
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/compare/base-sha...head-sha')) {
        return Response.json({
          files: [{ filename: 'notes/deleted.md', status: 'removed' }],
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    try {
      const { getServerDb, repo } = await import('./server-db');
      const { setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
        await import('./github-sync-runner');
      setGithubSyncLoopRunnerForTests(null);
      t.after(() => setGithubSyncLoopRunnerForTests(null));
      repo.insertSource({
        id: 's-deleted',
        title: 'Deleted',
        type: 'file',
        rawContent: '# Deleted',
        ingestedAt: Date.now(),
        externalKey: 'github:demo/vault:notes/deleted.md@old-sha',
        lastSyncedCommitSha: 'base-sha',
      });

      const result = startGithubSyncFromWebhook({
        deliveryId: 'delivery-compare',
        event: 'push',
        signatureSha256: 'sha256=test',
        beforeSha: 'base-sha',
        afterSha: 'head-sha',
      });
      await waitForSyncLoops();

      const item = getServerDb()
        .prepare(`SELECT path, change_type, status FROM sync_run_items WHERE run_id LIKE 'sr-%'`)
        .get() as { path: string; change_type: string; status: string } | undefined;

      assert.equal(result.existing, false);
      assert.ok(calls.some((url) => url.includes('/compare/base-sha...head-sha')));
      assert.equal(
        calls.some((url) => url.includes('/git/trees/')),
        false,
      );
      assert.deepEqual(item, {
        path: 'notes/deleted.md',
        change_type: 'delete',
        status: 'succeeded',
      });
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  },
);

type DeliveryRow = {
  delivery_id: string;
  event: string;
  ref: string | null;
  before_sha: string | null;
  after_sha: string | null;
  status: string;
  attempts: number;
  lease_version: number;
  job_id: string | null;
  error: string | null;
  signature_sha256: string;
};

async function readDelivery(deliveryId: string): Promise<DeliveryRow> {
  const { getServerDb } = await import('./server-db');
  return getServerDb()
    .prepare(
      `SELECT delivery_id, event, ref, before_sha, after_sha, status, attempts,
              lease_version, job_id, error, signature_sha256
         FROM webhook_deliveries WHERE delivery_id = ?`,
    )
    .get(deliveryId) as DeliveryRow;
}

test(
  'webhook B stays queued while A is running and auto-runs after A finishes',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { getServerDb, repo } = await import('./server-db');
    const { setGithubSyncLoopRunnerForTests, startGithubSync, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => setGithubSyncLoopRunnerForTests(null));

    const runs: Array<{ jobId: string; afterSha?: string }> = [];
    const gate = { release() {} };
    const aRunning = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    let seenFirstJob = false;
    setGithubSyncLoopRunnerForTests(async (jobId, options) => {
      runs.push({ jobId, afterSha: options.afterSha });
      if (!seenFirstJob) {
        seenFirstJob = true;
        await aRunning;
      }
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const a = startGithubSync({ triggerType: 'manual' });
    assert.equal(a.existing, false);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && runs.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runs.length, 1);

    const b = startGithubSyncFromWebhook({
      deliveryId: 'delivery-b',
      event: 'push',
      signatureSha256: 'sha256=b',
      ref: 'refs/heads/main',
      beforeSha: 'sha-a',
      afterSha: 'sha-b',
    });
    const whileA = await readDelivery('delivery-b');
    assert.equal(b.queued, true);
    assert.equal(b.existing, false);
    assert.ok(['received', 'queued'].includes(whileA.status));
    assert.equal(whileA.job_id, null);
    assert.notEqual(whileA.status, 'processed');
    assert.equal(
      (getServerDb().prepare(`SELECT COUNT(*) AS count FROM sync_jobs`).get() as { count: number })
        .count,
      1,
    );

    gate.release();
    await waitForSyncLoops();

    const afterA = await readDelivery('delivery-b');
    assert.equal(afterA.status, 'processed');
    assert.ok(afterA.job_id);
    assert.notEqual(afterA.job_id, a.jobId);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]?.afterSha, 'sha-b');
    assert.equal(
      (getServerDb().prepare(`SELECT COUNT(*) AS count FROM sync_jobs`).get() as { count: number })
        .count,
      2,
    );
  },
);

test(
  'webhook replay of B does not double-write rows or jobs',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { getServerDb, repo } = await import('./server-db');
    const { setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => setGithubSyncLoopRunnerForTests(null));
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const first = startGithubSyncFromWebhook({
      deliveryId: 'delivery-replay',
      event: 'push',
      signatureSha256: 'sha256=replay',
      ref: 'refs/heads/main',
      afterSha: 'sha-replay',
    });
    await waitForSyncLoops();
    const replay = startGithubSyncFromWebhook({
      deliveryId: 'delivery-replay',
      event: 'push',
      signatureSha256: 'sha256=replay',
      ref: 'refs/heads/main',
      afterSha: 'sha-replay',
    });
    await waitForSyncLoops();

    const rows = getServerDb()
      .prepare(`SELECT delivery_id FROM webhook_deliveries WHERE delivery_id = ?`)
      .all('delivery-replay') as Array<{ delivery_id: string }>;
    const jobs = getServerDb().prepare(`SELECT COUNT(*) AS count FROM sync_jobs`).get() as {
      count: number;
    };
    const delivery = await readDelivery('delivery-replay');
    assert.equal(first.existing, false);
    assert.equal(replay.existing, true);
    assert.equal(replay.jobId, first.jobId);
    assert.equal(rows.length, 1);
    assert.equal(jobs.count, 1);
    assert.equal(delivery.status, 'processed');
  },
);

test(
  'coalesced webhook deliveries for the same ref all reach a terminal state',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { setGithubSyncLoopRunnerForTests, startGithubSync, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => setGithubSyncLoopRunnerForTests(null));

    const gate = { release() {} };
    const aRunning = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const runs: Array<{ jobId: string; afterSha?: string; beforeSha?: string }> = [];
    let seenFirstJob = false;
    setGithubSyncLoopRunnerForTests(async (jobId, options) => {
      runs.push({ jobId, afterSha: options.afterSha, beforeSha: options.beforeSha });
      if (!seenFirstJob) {
        seenFirstJob = true;
        await aRunning;
      }
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    startGithubSync({ triggerType: 'manual' });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && runs.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    startGithubSyncFromWebhook({
      deliveryId: 'delivery-c1',
      event: 'push',
      signatureSha256: 'sha256=c1',
      ref: 'refs/heads/main',
      beforeSha: 'sha-0',
      afterSha: 'sha-1',
    });
    startGithubSyncFromWebhook({
      deliveryId: 'delivery-c2',
      event: 'push',
      signatureSha256: 'sha256=c2',
      ref: 'refs/heads/main',
      beforeSha: 'sha-1',
      afterSha: 'sha-2',
    });
    startGithubSyncFromWebhook({
      deliveryId: 'delivery-c3',
      event: 'push',
      signatureSha256: 'sha256=c3',
      ref: 'refs/heads/main',
      beforeSha: 'sha-2',
      afterSha: 'sha-3',
    });

    const pending = await Promise.all([
      readDelivery('delivery-c1'),
      readDelivery('delivery-c2'),
      readDelivery('delivery-c3'),
    ]);
    for (const row of pending) {
      assert.ok(['received', 'queued'].includes(row.status), `${row.delivery_id} stayed pending`);
      assert.equal(row.job_id, null);
    }

    gate.release();
    await waitForSyncLoops();

    const c1 = await readDelivery('delivery-c1');
    const c2 = await readDelivery('delivery-c2');
    const c3 = await readDelivery('delivery-c3');
    assert.equal(c1.status, 'coalesced');
    assert.equal(c2.status, 'coalesced');
    assert.equal(c3.status, 'processed');
    assert.ok(c1.job_id);
    assert.equal(c1.job_id, c2.job_id);
    assert.equal(c2.job_id, c3.job_id);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]?.beforeSha, 'sha-0');
    assert.equal(runs[1]?.afterSha, 'sha-3');
  },
);

test(
  'downloader resolve while job still running keeps the claim until the terminal hook',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const {
      notifyGithubSyncJobTerminal,
      setGithubSyncLoopRunnerForTests,
      startGithubSyncFromWebhook,
    } = await import('./github-sync-runner');
    t.after(() => setGithubSyncLoopRunnerForTests(null));

    const runs: string[] = [];
    let leaveFirstRunning = true;
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      runs.push(jobId);
      if (leaveFirstRunning) {
        leaveFirstRunning = false;
        return;
      }
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const a = startGithubSyncFromWebhook({
      deliveryId: 'delivery-winner',
      event: 'push',
      signatureSha256: 'sha256=winner',
      ref: 'refs/heads/main',
      afterSha: 'sha-a',
    });
    await waitForSyncLoops();
    const winnerWhileRunning = await readDelivery('delivery-winner');
    assert.equal(a.workerStarted, true);
    assert.equal(winnerWhileRunning.status, 'claimed');
    assert.equal(winnerWhileRunning.job_id, a.jobId);
    assert.equal(repo.getSyncJob(a.jobId)?.status, 'running');

    const b = startGithubSyncFromWebhook({
      deliveryId: 'delivery-pending-b',
      event: 'push',
      signatureSha256: 'sha256=pending-b',
      ref: 'refs/heads/main',
      afterSha: 'sha-b',
    });
    const pendingB = await readDelivery('delivery-pending-b');
    assert.equal(b.queued, true);
    assert.equal(b.workerStarted, false);
    assert.ok(['received', 'queued'].includes(pendingB.status));
    assert.equal(pendingB.job_id, null);
    assert.equal(runs.length, 1);

    repo.updateSyncJob(a.jobId, {
      status: 'done',
      finished_at: Date.now(),
      current: 'analysis done',
    });
    const firstHook = notifyGithubSyncJobTerminal(a.jobId);
    const secondHook = notifyGithubSyncJobTerminal(a.jobId);
    assert.equal(firstHook.finalized, true);
    assert.equal(firstHook.started, true);
    assert.equal(secondHook.finalized, false);
    await waitForSyncLoops();

    const winnerDone = await readDelivery('delivery-winner');
    const bDone = await readDelivery('delivery-pending-b');
    assert.equal(winnerDone.status, 'processed');
    assert.equal(winnerDone.job_id, a.jobId);
    assert.equal(bDone.status, 'processed');
    assert.ok(bDone.job_id);
    assert.notEqual(bDone.job_id, a.jobId);
    assert.equal(runs.length, 2);
    assert.equal(runs[1], bDone.job_id);
  },
);

test(
  'cancel does not drain B until the old downloader promise exits, and A is failed',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { cancelGithubSync, setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => setGithubSyncLoopRunnerForTests(null));

    const runs: string[] = [];
    const gate = { release() {} };
    const aRunning = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    let seenFirst = false;
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      runs.push(jobId);
      if (!seenFirst) {
        seenFirst = true;
        await aRunning;
        return;
      }
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const a = startGithubSyncFromWebhook({
      deliveryId: 'delivery-cancel-a',
      event: 'push',
      signatureSha256: 'sha256=cancel-a',
      ref: 'refs/heads/main',
      afterSha: 'sha-a',
    });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && runs.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    startGithubSyncFromWebhook({
      deliveryId: 'delivery-cancel-b',
      event: 'push',
      signatureSha256: 'sha256=cancel-b',
      ref: 'refs/heads/main',
      afterSha: 'sha-b',
    });

    cancelGithubSync();
    const aAfterCancel = await readDelivery('delivery-cancel-a');
    const bAfterCancel = await readDelivery('delivery-cancel-b');
    assert.equal(repo.getSyncJob(a.jobId)?.status, 'failed');
    assert.equal(aAfterCancel.status, 'claimed');
    assert.ok(['received', 'queued'].includes(bAfterCancel.status));
    assert.equal(bAfterCancel.job_id, null);
    assert.equal(runs.length, 1);
    assert.equal(
      (globalThis as unknown as { __activeSyncPromises?: Set<Promise<void>> }).__activeSyncPromises
        ?.size,
      1,
    );

    gate.release();
    await waitForSyncLoops();
    const aDone = await readDelivery('delivery-cancel-a');
    const bDone = await readDelivery('delivery-cancel-b');
    assert.equal(aDone.status, 'failed');
    assert.notEqual(aDone.status, 'processed');
    assert.equal(aDone.job_id, a.jobId);
    assert.equal(bDone.status, 'processed');
    assert.ok(bDone.job_id);
    assert.notEqual(bDone.job_id, a.jobId);
    assert.equal(runs.length, 2);
  },
);

test(
  'process drain leaves A claimed and running and does not start B',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { abortProcessDrainWork, getProcessDrainSignal, resetProcessDrainForTests } =
      await import('./process-drain');
    const { markProcessUnready, resetProcessReadinessForTests } =
      await import('./process-readiness');
    const { setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => {
      setGithubSyncLoopRunnerForTests(null);
      resetProcessDrainForTests();
      resetProcessReadinessForTests();
    });
    resetProcessDrainForTests();
    resetProcessReadinessForTests();

    const runs: string[] = [];
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      runs.push(jobId);
      const signal = getProcessDrainSignal();
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

    const a = startGithubSyncFromWebhook({
      deliveryId: 'drain-a',
      event: 'push',
      signatureSha256: 'sha256=drain-a',
      ref: 'refs/heads/main',
      afterSha: 'sha-a',
    });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && runs.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const b = startGithubSyncFromWebhook({
      deliveryId: 'drain-b',
      event: 'push',
      signatureSha256: 'sha256=drain-b',
      ref: 'refs/heads/other',
      afterSha: 'sha-b',
    });
    assert.equal(b.queued, true);
    assert.equal(b.draining, undefined);

    markProcessUnready('drain');
    abortProcessDrainWork();
    await waitForSyncLoops();

    const aRow = await readDelivery('drain-a');
    const bRow = await readDelivery('drain-b');
    assert.equal(aRow.status, 'claimed');
    assert.equal(aRow.job_id, a.jobId);
    assert.equal(repo.getSyncJob(a.jobId)?.status, 'running');
    assert.ok(['received', 'queued'].includes(bRow.status));
    assert.equal(bRow.job_id, null);
    assert.equal(runs.length, 1);

    const refused = startGithubSyncFromWebhook({
      deliveryId: 'drain-c',
      event: 'push',
      signatureSha256: 'sha256=drain-c',
      ref: 'refs/heads/third',
      afterSha: 'sha-c',
    });
    assert.equal(refused.draining, true);
    assert.equal(refused.queued, true);
    assert.equal(refused.workerStarted, false);
    assert.equal(runs.length, 1);
  },
);

test(
  'late GitHub fetch after drain does not queue ingest or hard-delete',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const previousEnv = {
      GITHUB_REPO: process.env.GITHUB_REPO,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_BRANCH: process.env.GITHUB_BRANCH,
      COMPOUND_GITHUB_DELETE_MODE: process.env.COMPOUND_GITHUB_DELETE_MODE,
    };
    process.env.GITHUB_REPO = 'demo/vault';
    process.env.GITHUB_TOKEN = 'secret-token-must-not-leak';
    process.env.GITHUB_BRANCH = 'main';
    process.env.COMPOUND_GITHUB_DELETE_MODE = 'hard';
    const originalFetch = globalThis.fetch;
    const { markProcessUnready, resetProcessReadinessForTests } =
      await import('./process-readiness');
    const { resetProcessDrainForTests } = await import('./process-drain');
    t.after(() => {
      globalThis.fetch = originalFetch;
      resetProcessDrainForTests();
      resetProcessReadinessForTests();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    resetProcessDrainForTests();
    resetProcessReadinessForTests();

    const { getServerDb, repo } = await import('./server-db');
    const { setGithubSyncLoopRunnerForTests, startGithubSync } =
      await import('./github-sync-runner');
    setGithubSyncLoopRunnerForTests(null);
    repo.insertSource({
      id: 's-deleted',
      title: 'Deleted',
      type: 'file',
      rawContent: '# Deleted',
      ingestedAt: Date.now(),
      externalKey: 'github:demo/vault:notes/keep.md@old-sha',
      lastSyncedCommitSha: 'head-sha',
    });

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/branches/main')) {
        return Response.json({
          commit: { sha: 'head-sha', commit: { tree: { sha: 'tree-sha' } } },
        });
      }
      if (url.includes('/git/trees/tree-sha')) {
        markProcessUnready('drain');
        return Response.json({
          truncated: false,
          tree: [{ path: 'notes/new.md', type: 'blob', sha: 'sha-new', size: 12 }],
        });
      }
      if (url.includes('/contents/notes/new.md')) {
        return new Response('# late', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    const started = startGithubSync({ triggerType: 'manual' });
    await waitForSyncLoops();

    const job = repo.getSyncJob(started.jobId);
    assert.equal(job?.status, 'running');
    const analysisCount = Number(
      (
        (getServerDb()
          .prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'analysis_jobs'`,
          )
          .get() as { count: number }) ?? { count: 0 }
      ).count,
    );
    const queued =
      analysisCount > 0
        ? (
            getServerDb().prepare(`SELECT COUNT(*) AS count FROM analysis_jobs`).get() as {
              count: number;
            }
          ).count
        : 0;
    assert.equal(queued, 0);
    const remaining = getServerDb()
      .prepare(`SELECT COUNT(*) AS count FROM sources WHERE id = 's-deleted'`)
      .get() as { count: number };
    assert.equal(remaining.count, 1);
    const successItems = getServerDb()
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'sync_run_items'`,
      )
      .get() as { count: number };
    if (successItems.count > 0) {
      const succeeded = getServerDb()
        .prepare(`SELECT COUNT(*) AS count FROM sync_run_items WHERE status = 'succeeded'`)
        .get() as { count: number };
      assert.equal(succeeded.count, 0);
    }
  },
);

test(
  'late markdown content after drain is not queued for ingest',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const previousEnv = {
      GITHUB_REPO: process.env.GITHUB_REPO,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_BRANCH: process.env.GITHUB_BRANCH,
    };
    process.env.GITHUB_REPO = 'demo/vault';
    process.env.GITHUB_TOKEN = 'secret';
    process.env.GITHUB_BRANCH = 'main';
    const originalFetch = globalThis.fetch;
    const { markProcessUnready, resetProcessReadinessForTests } =
      await import('./process-readiness');
    const { resetProcessDrainForTests } = await import('./process-drain');
    t.after(() => {
      globalThis.fetch = originalFetch;
      resetProcessDrainForTests();
      resetProcessReadinessForTests();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    resetProcessDrainForTests();
    resetProcessReadinessForTests();

    const gate = { release() {}, started() {} };
    const contentStarted = new Promise<void>((resolve) => {
      gate.started = resolve;
    });
    const contentRelease = new Promise<void>((resolve) => {
      gate.release = resolve;
    });

    const { getServerDb } = await import('./server-db');
    const { setGithubSyncLoopRunnerForTests, startGithubSync } =
      await import('./github-sync-runner');
    setGithubSyncLoopRunnerForTests(null);

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/branches/main')) {
        return Response.json({
          commit: { sha: 'head-sha', commit: { tree: { sha: 'tree-sha' } } },
        });
      }
      if (url.includes('/git/trees/tree-sha')) {
        return Response.json({
          truncated: false,
          tree: [{ path: 'notes/new.md', type: 'blob', sha: 'sha-new', size: 12 }],
        });
      }
      if (url.includes('/contents/notes/new.md')) {
        gate.started();
        await contentRelease;
        return new Response('# late body', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    }) as typeof fetch;

    startGithubSync({ triggerType: 'manual' });
    await contentStarted;
    markProcessUnready('drain');
    gate.release();
    await waitForSyncLoops();

    const hasAnalysis = (
      getServerDb()
        .prepare(
          `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'analysis_jobs'`,
        )
        .get() as { count: number }
    ).count;
    const queued =
      hasAnalysis > 0
        ? (
            getServerDb().prepare(`SELECT COUNT(*) AS count FROM analysis_jobs`).get() as {
              count: number;
            }
          ).count
        : 0;
    assert.equal(queued, 0);
  },
);

test(
  'boot recovery after process drain continues A then B in inbox order',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const { abortProcessDrainWork, getProcessDrainSignal, resetProcessDrainForTests } =
      await import('./process-drain');
    const { markProcessUnready, resetProcessReadinessForTests } =
      await import('./process-readiness');
    const { runBootRecovery } = await import('./boot-recovery');
    const { setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
      await import('./github-sync-runner');
    t.after(() => {
      setGithubSyncLoopRunnerForTests(null);
      resetProcessDrainForTests();
      resetProcessReadinessForTests();
    });
    resetProcessDrainForTests();
    resetProcessReadinessForTests();

    const runs: string[] = [];
    let hangFirst = true;
    setGithubSyncLoopRunnerForTests(async (jobId) => {
      runs.push(jobId);
      if (hangFirst) {
        const signal = getProcessDrainSignal();
        if (!signal.aborted) {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
        }
        return;
      }
      repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
    });

    const a = startGithubSyncFromWebhook({
      deliveryId: 'boot-order-a',
      event: 'push',
      signatureSha256: 'sha256=boot-a',
      ref: 'refs/heads/main',
      afterSha: 'sha-a',
    });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && runs.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    startGithubSyncFromWebhook({
      deliveryId: 'boot-order-b',
      event: 'push',
      signatureSha256: 'sha256=boot-b',
      ref: 'refs/heads/topic',
      afterSha: 'sha-b',
    });

    markProcessUnready('drain');
    abortProcessDrainWork();
    await waitForSyncLoops();
    assert.equal((await readDelivery('boot-order-a')).status, 'claimed');
    assert.ok(['received', 'queued'].includes((await readDelivery('boot-order-b')).status));

    hangFirst = false;
    resetProcessDrainForTests();
    resetProcessReadinessForTests();
    runBootRecovery();
    await waitForSyncLoops();

    const aDone = await readDelivery('boot-order-a');
    const bDone = await readDelivery('boot-order-b');
    assert.equal(aDone.status, 'processed');
    assert.equal(bDone.status, 'processed');
    assert.notEqual(aDone.job_id, a.jobId);
    assert.ok(bDone.job_id);
    assert.notEqual(aDone.job_id, bDone.job_id);
    assert.ok(runs.length >= 3);
    assert.equal(runs[1], aDone.job_id);
    assert.equal(runs[2], bDone.job_id);
  },
);
