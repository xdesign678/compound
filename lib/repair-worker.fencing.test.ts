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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-repair-fence-'));
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

async function withMockFetch<T>(mockFetch: typeof fetch, fn: () => Promise<T> | T): Promise<T> {
  const previous = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = previous;
  }
}

async function seedConcepts(
  repo: {
    upsertConcept: (c: {
      id: string;
      title: string;
      summary: string;
      body: string;
      sources: string[];
      related: string[];
      categories: never[];
      categoryKeys: never[];
      createdAt: number;
      updatedAt: number;
      version: number;
    }) => void;
  },
  rows: Array<{ id: string; title: string; summary: string; body: string; related?: string[] }>,
) {
  const now = Date.now();
  for (const row of rows) {
    repo.upsertConcept({
      id: row.id,
      title: row.title,
      summary: row.summary,
      body: row.body,
      sources: [],
      related: row.related || [],
      categories: [],
      categoryKeys: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }
}

async function waitForRunDone(runId: string, timeoutMs = 10_000): Promise<void> {
  const { getRepairRunStatus } = await import('./repair-worker');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = getRepairRunStatus(runId);
    if (status && status.status !== 'running') return;
    const db = (await import('./server-db')).getServerDb();
    const job = db
      .prepare(`SELECT status, locked_by, lease_version FROM repair_jobs WHERE run_id = ?`)
      .get(runId) as
      | { status: string; locked_by: string | null; lease_version: number }
      | undefined;
    if (job && job.locked_by === 'worker-b' && job.status === 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`repair run ${runId} did not settle within ${timeoutMs}ms`);
}

test('repair claim monotonically increments lease_version', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun, claimRepairJob } = await import('./repair-worker');

  ensureRepairSchema();
  await seedConcepts(repo, [
    { id: 'c-a', title: 'A', summary: 'a', body: 'body a' },
    { id: 'c-b', title: 'B', summary: 'b', body: 'body b' },
  ]);
  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'link', conceptIds: ['c-a', 'c-b'] },
  ]);

  const first = claimRepairJob(runId);
  assert.ok(first);
  assert.equal(first.lease_version, 1);
  assert.equal(first.status, 'running');

  getServerDb()
    .prepare(
      `UPDATE repair_jobs SET status = 'queued', locked_by = NULL, locked_at = NULL WHERE id = ?`,
    )
    .run(first.id);

  const second = claimRepairJob(runId);
  assert.ok(second);
  assert.equal(second.lease_version, 2);
  assert.ok(second.lease_version > first.lease_version);
});

test('stale repair worker cannot mark done or mutate B-owned job status', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { ensureRepairSchema, createRepairRun, claimRepairJob, markRepairJob } =
    await import('./repair-worker');

  ensureRepairSchema();
  await seedConcepts(repo, [
    { id: 'c-a', title: 'A', summary: 'a', body: 'body a' },
    { id: 'c-b', title: 'B', summary: 'b', body: 'body b' },
  ]);
  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'link', conceptIds: ['c-a', 'c-b'] },
  ]);
  const stale = claimRepairJob(runId);
  assert.ok(stale);

  const db = getServerDb();
  db.prepare(
    `UPDATE repair_jobs
        SET locked_by = 'worker-b', lease_version = ?, status = 'running'
      WHERE id = ?`,
  ).run((stale.lease_version ?? 0) + 1, stale.id);

  assert.equal(markRepairJob(stale, 'done'), false);
  assert.equal(markRepairJob(stale, 'failed', { error: 'stale' }), false);
  assert.equal(markRepairJob(stale, 'skipped'), false);

  const after = db
    .prepare(`SELECT status, locked_by, lease_version, error FROM repair_jobs WHERE id = ?`)
    .get(stale.id) as {
    status: string;
    locked_by: string;
    lease_version: number;
    error: string | null;
  };
  assert.equal(after.status, 'running');
  assert.equal(after.locked_by, 'worker-b');
  assert.equal(after.lease_version, (stale.lease_version ?? 0) + 1);
  assert.equal(after.error, null);
});

test('merge late LLM result cannot delete or rewrite concepts after lease steal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { createRepairRun, startRepairWorker } = await import('./repair-worker');

  await seedConcepts(repo, [
    {
      id: 'c-p',
      title: 'Primary',
      summary: 'p',
      body: 'primary body with additional substantive content so it wins pickPrimary',
    },
    { id: 'c-s', title: 'Secondary', summary: 's', body: 'secondary body' },
    { id: 'c-ref', title: 'Ref', summary: 'r', body: 'ref body', related: ['c-s'] },
  ]);

  const { runId } = createRepairRun([
    { type: 'duplicate', message: 'dup', conceptIds: ['c-p', 'c-s'] },
  ]);
  const db = getServerDb();

  await withMockFetch(
    async () => {
      const job = db
        .prepare(`SELECT id, lease_version FROM repair_jobs WHERE run_id = ?`)
        .get(runId) as {
        id: string;
        lease_version: number;
      };
      db.prepare(
        `UPDATE repair_jobs SET locked_by = 'worker-b', lease_version = ?, status = 'running' WHERE id = ?`,
      ).run((job.lease_version ?? 0) + 1, job.id);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Should not land',
                  summary: 'stolen',
                  body: 'stolen merge body from stale worker A',
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    async () => {
      startRepairWorker(runId);
      await waitForRunDone(runId);
    },
  );

  const primary = repo.getConcept('c-p');
  const secondary = repo.getConcept('c-s');
  const ref = repo.getConcept('c-ref');
  assert.ok(primary, 'primary must survive');
  assert.ok(secondary, 'secondary must survive — A wrote zero business rows');
  assert.equal(primary.title, 'Primary');
  assert.match(primary.body, /primary body/);
  assert.equal(primary.version, 1);
  assert.deepEqual(ref?.related, ['c-s']);

  const job = db
    .prepare(`SELECT status, locked_by, lease_version FROM repair_jobs WHERE run_id = ?`)
    .get(runId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(job.status, 'running');
  assert.equal(job.locked_by, 'worker-b');
});

test('orphan late LLM result cannot rewrite related ids after lease steal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { createRepairRun, startRepairWorker } = await import('./repair-worker');

  await seedConcepts(repo, [
    { id: 'c-orphan', title: 'Island', summary: 'alone', body: 'orphan body' },
    { id: 'c-cand', title: 'Candidate', summary: 'nearby', body: 'candidate body' },
  ]);

  const { runId } = createRepairRun([
    { type: 'orphan', message: 'island', conceptIds: ['c-orphan'] },
  ]);
  const db = getServerDb();

  await withMockFetch(
    async () => {
      const job = db
        .prepare(`SELECT id, lease_version FROM repair_jobs WHERE run_id = ?`)
        .get(runId) as {
        id: string;
        lease_version: number;
      };
      db.prepare(
        `UPDATE repair_jobs SET locked_by = 'worker-b', lease_version = ?, status = 'running' WHERE id = ?`,
      ).run((job.lease_version ?? 0) + 1, job.id);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ relatedIds: ['c-cand'] }) },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    async () => {
      startRepairWorker(runId);
      await waitForRunDone(runId);
    },
  );

  const orphan = repo.getConcept('c-orphan');
  const cand = repo.getConcept('c-cand');
  assert.deepEqual(orphan?.related ?? [], [], 'orphan related must stay empty');
  assert.deepEqual(cand?.related ?? [], [], 'candidate related must stay empty');
  assert.equal(orphan?.version, 1);
  assert.equal(cand?.version, 1);

  const job = db
    .prepare(`SELECT status, locked_by FROM repair_jobs WHERE run_id = ?`)
    .get(runId) as { status: string; locked_by: string };
  assert.equal(job.status, 'running');
  assert.equal(job.locked_by, 'worker-b');
});

test('IMMEDIATE repair lease txn blocks peer takeover until A commits', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const { createRepairRun, claimRepairJob, withRepairJobLease } = await import('./repair-worker');
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');

  await seedConcepts(repo, [
    { id: 'c-lock-a', title: 'A', summary: 'a', body: 'body a' },
    { id: 'c-lock-b', title: 'B', summary: 'b', body: 'body b' },
  ]);
  const { runId } = createRepairRun([
    { type: 'missing-link', message: 'link', conceptIds: ['c-lock-a', 'c-lock-b'] },
  ]);
  const job = claimRepairJob(runId);
  assert.ok(job);

  const peer = new Database(path.join(process.env.DATA_DIR as string, 'compound.db'));
  peer.pragma('journal_mode = WAL');
  peer.pragma('busy_timeout = 50');
  t.after(() => peer.close());

  let peerTookOverWhileAHeld = false;
  const applied = withRepairJobLease(job, () => {
    try {
      peer
        .prepare(`UPDATE repair_jobs SET locked_by = 'worker-b', lease_version = ? WHERE id = ?`)
        .run((job.lease_version ?? 0) + 1, job.id);
      peerTookOverWhileAHeld = true;
    } catch (err) {
      assert.match(String(err), /busy|locked/i);
    }
    const a = repo.getConcept('c-lock-a')!;
    repo.upsertConcept({
      ...a,
      related: Array.from(new Set([...a.related, 'c-lock-b'])),
      updatedAt: Date.now(),
      version: a.version + 1,
    });
    return true;
  });

  assert.equal(applied, true);
  assert.equal(peerTookOverWhileAHeld, false);
  assert.ok(repo.getConcept('c-lock-a')?.related.includes('c-lock-b'));
});
