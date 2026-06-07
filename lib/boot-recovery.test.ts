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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-boot-'));
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ['DATA_DIR', 'LLM_API_KEY', 'LLM_API_URL', 'COMPOUND_SKIP_DNS_GUARD']) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.DATA_DIR = tempDir;
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  closeServerDbGlobal();
  return {
    tempDir,
    cleanup() {
      closeServerDbGlobal();
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

const STALE_AT = Date.now() - 30 * 60 * 1000;

test(
  'ensureRepairSchema adds lease/heartbeat columns and is idempotent',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { ensureRepairSchema } = await import('./repair-worker');
    const { getServerDb } = await import('./server-db');

    ensureRepairSchema();
    // Running the migration twice must not throw (additive + idempotent).
    ensureRepairSchema();

    const cols = new Set(
      (
        getServerDb().prepare(`PRAGMA table_info(repair_jobs)`).all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    assert.ok(cols.has('locked_at'), 'locked_at column exists');
    assert.ok(cols.has('lease_expires_at'), 'lease_expires_at column exists');
  },
);

test(
  'recoverStaleRepairJobs requeues lease-expired running jobs but keeps fresh leases',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { ensureRepairSchema, recoverStaleRepairJobs } = await import('./repair-worker');
    const { getServerDb } = await import('./server-db');
    ensureRepairSchema();
    const db = getServerDb();

    db.prepare(
      `INSERT INTO repair_runs (id, status, total, done, failed, started_at, summary)
       VALUES ('rp-lease', 'running', 2, 0, 0, ?, '{}')`,
    ).run(STALE_AT);
    // Job locked by a dead worker: lease already expired.
    db.prepare(
      `INSERT INTO repair_jobs (id, run_id, kind, payload_json, status, attempts, locked_by, locked_at, lease_expires_at, updated_at)
       VALUES ('rj-stale', 'rp-lease', 'link', '{"conceptIds":["c-a","c-b"]}', 'running', 1, 'dead-worker', ?, ?, ?)`,
    ).run(STALE_AT, STALE_AT, STALE_AT);
    // Job freshly claimed: lease still in the future, must survive.
    const future = Date.now() + 5 * 60 * 1000;
    db.prepare(
      `INSERT INTO repair_jobs (id, run_id, kind, payload_json, status, attempts, locked_by, locked_at, lease_expires_at, updated_at)
       VALUES ('rj-fresh', 'rp-lease', 'link', '{"conceptIds":["c-c","c-d"]}', 'running', 1, 'live-worker', ?, ?, ?)`,
    ).run(Date.now(), future, Date.now());

    const recovered = recoverStaleRepairJobs();
    assert.equal(recovered.requeued, 1, 'exactly the stale job is requeued');
    assert.equal(recovered.deadLettered, 0, 'no jobs dead-lettered');

    const stale = db
      .prepare(`SELECT status, locked_by FROM repair_jobs WHERE id = 'rj-stale'`)
      .get() as {
      status: string;
      locked_by: string | null;
    };
    const fresh = db.prepare(`SELECT status FROM repair_jobs WHERE id = 'rj-fresh'`).get() as {
      status: string;
    };
    assert.equal(stale.status, 'queued', 'expired-lease job reset to queued');
    assert.equal(stale.locked_by, null, 'expired-lease job lock cleared');
    assert.equal(fresh.status, 'running', 'fresh-lease job left running');
  },
);

test(
  'runBootRecovery fails stuck sync jobs, finalizes stuck repair runs, requeues stale analysis jobs',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { getServerDb, repo } = await import('./server-db');
    const { ensureAnalysisWorkerSchema } = await import('./analysis-worker');
    const { ensureRepairSchema, getRepairRunStatus } = await import('./repair-worker');
    const { runBootRecovery } = await import('./boot-recovery');

    // Stuck sync job: running with a stale heartbeat.
    repo.insertSyncJob({
      id: 'job-stuck-boot',
      kind: 'github',
      status: 'running',
      total: 0,
      done: 0,
      failed: 0,
      current: null,
      log: null,
      error: null,
      started_at: STALE_AT,
      finished_at: null,
      heartbeat_at: STALE_AT,
    });

    // Stuck repair run: running with no claimable jobs.
    ensureRepairSchema();
    getServerDb()
      .prepare(
        `INSERT INTO repair_runs (id, status, total, done, failed, started_at, summary)
         VALUES ('rp-stuck-boot', 'running', 0, 0, 0, ?, '{}')`,
      )
      .run(STALE_AT);

    // Stale analysis job: running, lease expired, attempts < max_attempts.
    ensureAnalysisWorkerSchema();
    getServerDb()
      .prepare(
        `INSERT INTO analysis_jobs (id, source_id, stage, stage_version, status, attempts, max_attempts, locked_at, started_at, updated_at)
         VALUES ('aj-stuck-boot', 'src-boot', 'github_ingest', 'v1', 'running', 0, 3, ?, ?, ?)`,
      )
      .run(STALE_AT, STALE_AT, STALE_AT);

    runBootRecovery();

    const syncJob = repo.getSyncJob('job-stuck-boot');
    assert.equal(syncJob?.status, 'failed', 'stuck sync job marked failed');

    const analysis = getServerDb()
      .prepare(`SELECT status FROM analysis_jobs WHERE id = 'aj-stuck-boot'`)
      .get() as { status: string };
    assert.equal(analysis.status, 'queued', 'stale analysis job requeued');

    // The empty repair run is finalized asynchronously by the resumed loop.
    const deadline = Date.now() + 10_000;
    let repairStatus = getRepairRunStatus('rp-stuck-boot')?.status;
    while (Date.now() < deadline && repairStatus === 'running') {
      await new Promise((r) => setTimeout(r, 25));
      repairStatus = getRepairRunStatus('rp-stuck-boot')?.status;
    }
    assert.ok(
      repairStatus === 'done' || repairStatus === 'failed',
      `stuck repair run reaches terminal (got ${repairStatus})`,
    );

    // Idempotent: running again must not throw.
    runBootRecovery();
  },
);
