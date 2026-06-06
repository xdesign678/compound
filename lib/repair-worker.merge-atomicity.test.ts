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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-merge-atomicity-'));
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

const mergeResponse: typeof fetch = async () =>
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

test(
  'runMergeJob rolls back the whole concept mutation when compile throws after delete',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    const now = Date.now();
    const seed = (id: string, title: string, body: string, related: string[] = []) =>
      repo.upsertConcept({
        id,
        title,
        summary: title.toLowerCase(),
        body,
        sources: [],
        related,
        categories: [],
        categoryKeys: [],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });

    seed('c-p', 'Primary', 'primary body with enough substantive content to win pickPrimary');
    seed('c-s', 'Secondary', 'secondary body');
    seed('c-ref', 'Ref', 'ref body', ['c-s']);

    const wikiDb = await import('./wiki-db');
    const realIndex = wikiDb.wikiRepo.indexConcept.bind(wikiDb.wikiRepo);
    wikiDb.wikiRepo.indexConcept = () => {
      throw new Error('injected compile failure');
    };

    try {
      await withMockFetch(mergeResponse, async () => {
        const { createRepairRun, startRepairWorker, getRepairRunStatus } =
          await import('./repair-worker');
        const { runId } = createRepairRun([
          { type: 'duplicate', message: 'dup', conceptIds: ['c-p', 'c-s'] },
        ]);
        startRepairWorker(runId);
        await waitForRunDone(runId);

        const status = getRepairRunStatus(runId)!;
        assert.equal(status.failed, 1, 'merge job should fail when compile throws');
        assert.equal(status.summary.merged, 0, 'merge counter not bumped on failure');
      });
    } finally {
      wikiDb.wikiRepo.indexConcept = realIndex;
    }

    // Atomic rollback: secondary survives, no duplicate, primary unchanged, ref still points to secondary.
    const primary = repo.getConcept('c-p')!;
    const secondary = repo.getConcept('c-s');
    const ref = repo.getConcept('c-ref')!;

    assert.ok(secondary, 'secondary must survive rollback (no dangling delete)');
    assert.equal(primary.title, 'Primary', 'primary title unchanged after rollback');
    assert.equal(
      primary.body,
      'primary body with enough substantive content to win pickPrimary',
      'primary body unchanged after rollback',
    );
    assert.equal(primary.version, 1, 'primary version unchanged after rollback');
    assert.deepEqual(ref.related, ['c-s'], 'ref still references secondary (no premature rewire)');
  },
);
