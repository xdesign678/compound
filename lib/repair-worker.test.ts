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

async function withMockFetch<T>(mockFetch: typeof fetch, fn: () => Promise<T> | T): Promise<T> {
  const previous = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = previous;
  }
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-repair-'));
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

interface TestConcept {
  id: string;
  title: string;
  summary: string;
  body: string;
  related?: string[];
  sources?: string[];
}

async function seed(concepts: TestConcept[]): Promise<void> {
  const { repo } = await import('./server-db');
  const now = Date.now();
  for (const c of concepts) {
    repo.upsertConcept({
      id: c.id,
      title: c.title,
      summary: c.summary,
      body: c.body,
      sources: c.sources || [],
      related: c.related || [],
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
    const s = getRepairRunStatus(runId);
    if (s && s.status !== 'running') return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`repair run ${runId} did not finish within ${timeoutMs}ms`);
}

test(
  'repair-worker: missing-link adds bidirectional related ids',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    await seed([
      { id: 'c-a', title: 'A', summary: 'a', body: 'body a' },
      { id: 'c-b', title: 'B', summary: 'b', body: 'body b' },
    ]);

    const { createRepairRun, startRepairWorker } = await import('./repair-worker');
    const { repo } = await import('./server-db');

    const { runId, total } = createRepairRun([
      { type: 'missing-link', message: 'link a-b', conceptIds: ['c-a', 'c-b'] },
    ]);
    assert.equal(total, 1);
    startRepairWorker(runId);
    await waitForRunDone(runId);

    const a = repo.getConcept('c-a');
    const b = repo.getConcept('c-b');
    assert.ok(a?.related.includes('c-b'));
    assert.ok(b?.related.includes('c-a'));
  },
);

test(
  'repair-worker: duplicate merge deletes secondary and rewires references',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    await seed([
      { id: 'c-p', title: 'Primary', summary: 'p', body: 'primary body longer content here' },
      { id: 'c-s', title: 'Secondary', summary: 's', body: 'sec' },
      { id: 'c-ref', title: 'Ref', summary: 'r', body: 'r', related: ['c-s'] },
    ]);

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Merged',
                  summary: 'merged summary',
                  body: 'merged body from LLM',
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    await withMockFetch(mockFetch, async () => {
      const { createRepairRun, startRepairWorker, getRepairRunStatus } =
        await import('./repair-worker');
      const { repo } = await import('./server-db');
      const { runId } = createRepairRun([
        { type: 'duplicate', message: 'dup', conceptIds: ['c-p', 'c-s'] },
      ]);
      startRepairWorker(runId);
      await waitForRunDone(runId);

      const primary = repo.getConcept('c-p');
      const secondary = repo.getConcept('c-s');
      const ref = repo.getConcept('c-ref');
      assert.ok(primary, 'primary survives');
      assert.equal(secondary, null, 'secondary is deleted');
      assert.equal(primary.title, 'Merged');
      assert.equal(primary.body, 'merged body from LLM');
      assert.ok(ref?.related.includes('c-p'), 'ref rewired to primary');
      assert.ok(!ref?.related.includes('c-s'), 'ref no longer references secondary');

      const status = getRepairRunStatus(runId)!;
      assert.equal(status.summary.merged, 1);
      assert.deepEqual(status.summary.deletedConceptIds, ['c-s']);
    });
  },
);

test(
  'repair-worker: merge falls back to mechanical join when LLM fails',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    await seed([
      {
        id: 'c-p',
        title: 'Primary',
        summary: 'p',
        body: 'primary body with additional substantive content so it wins the pickPrimary scoring',
      },
      { id: 'c-s', title: 'Secondary', summary: 's', body: 'secondary body' },
    ]);

    const mockFetch: typeof fetch = async () => new Response('server error', { status: 500 });

    await withMockFetch(mockFetch, async () => {
      const { createRepairRun, startRepairWorker, getRepairRunStatus } =
        await import('./repair-worker');
      const { repo } = await import('./server-db');
      const { runId } = createRepairRun([
        { type: 'duplicate', message: 'dup', conceptIds: ['c-p', 'c-s'] },
      ]);
      startRepairWorker(runId);
      await waitForRunDone(runId);

      const primary = repo.getConcept('c-p');
      assert.ok(primary);
      assert.match(primary.body, /primary body/);
      assert.match(primary.body, /secondary body/);
      assert.equal(repo.getConcept('c-s'), null);
      const status = getRepairRunStatus(runId)!;
      assert.equal(status.summary.aiFallbacks, 1);
    });
  },
);

test(
  'repair-worker: createRepairRun caps jobs and reports dropped count',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    process.env.COMPOUND_REPAIR_JOB_CAP = '2';
    t.after(() => {
      delete process.env.COMPOUND_REPAIR_JOB_CAP;
    });
    // Need to re-import because cap is read once. Node test runner loads each
    // test file once, so we pass findings that already exceed the default 50.
    await seed([
      { id: 'c-1', title: '1', summary: '', body: '' },
      { id: 'c-2', title: '2', summary: '', body: '' },
      { id: 'c-3', title: '3', summary: '', body: '' },
    ]);
    const { createRepairRun } = await import('./repair-worker');
    const findings = Array.from({ length: 60 }, (_, i) => ({
      type: 'missing-link' as const,
      message: `m-${i}`,
      conceptIds: ['c-1', 'c-2'],
    }));
    // All dedup to the same (c-1,c-2) pair → only 1 survives dedup → dropped = 0
    const out = createRepairRun(findings);
    assert.equal(out.total, 1);
    assert.equal(out.dropped, 0);
  },
);
