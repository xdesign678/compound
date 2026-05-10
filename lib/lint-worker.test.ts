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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-lint-'));
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    'DATA_DIR',
    'LLM_API_KEY',
    'LLM_API_URL',
    'LLM_MODEL',
    'COMPOUND_SKIP_DNS_GUARD',
    'COMPOUND_LINT_BATCH_SIZE',
    'COMPOUND_LINT_MAX_TOKENS',
  ]) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.DATA_DIR = tempDir;
  process.env.LLM_API_KEY = 'server-key';
  process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  closeServerDbGlobal();
  delete (globalThis as Record<string, unknown>).__compoundLintWorkers;
  return {
    cleanup() {
      closeServerDbGlobal();
      delete (globalThis as Record<string, unknown>).__compoundLintWorkers;
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function seedConcepts(count = 2): Promise<void> {
  const { repo } = await import('./server-db');
  const now = Date.now();
  const concepts =
    count === 2
      ? [
          { id: 'c-a', title: 'Alpha', related: ['c-b'] },
          { id: 'c-b', title: 'Beta', related: ['c-a'] },
        ]
      : Array.from({ length: count }, (_, index) => ({
          id: `c-${index + 1}`,
          title: `Concept ${index + 1}`,
          related: index > 0 ? [`c-${index}`] : [],
        }));

  for (const concept of concepts) {
    repo.upsertConcept({
      id: concept.id,
      title: concept.title,
      summary: `${concept.title} summary`,
      body: `${concept.title} body`,
      sources: [],
      related: concept.related,
      categories: [],
      categoryKeys: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
  }
}

async function waitForLintRunDone(runId: string, timeoutMs = 10_000): Promise<void> {
  const { getLintRunStatus } = await import('./lint-worker');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = getLintRunStatus(runId);
    if (status && status.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`lint run ${runId} did not finish within ${timeoutMs}ms`);
}

test('lint-worker uses per-run LLM config overrides', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  await seedConcepts();

  let sawRequest = false;
  const mockFetch: typeof fetch = async (input, init) => {
    sawRequest = true;
    assert.equal(String(input), 'https://llm.example.com/v1/chat/completions');
    const headers = new Headers(init?.headers as HeadersInit);
    assert.equal(headers.get('authorization'), 'Bearer user-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'user-model');
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                findings: [
                  {
                    type: 'missing-link',
                    message: 'Alpha should link Beta',
                    conceptIds: ['c-a', 'c-b', 'missing-id'],
                  },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  await withMockFetch(mockFetch, async () => {
    const { createLintRun, getLintRunStatus, startLintWorker } = await import('./lint-worker');
    const runId = createLintRun();
    startLintWorker(runId, {
      apiKey: 'user-key',
      apiUrl: 'https://llm.example.com/v1/chat/completions',
      model: 'user-model',
    });
    await waitForLintRunDone(runId);

    const status = getLintRunStatus(runId);
    assert.equal(status?.status, 'done');
    assert.equal(status?.phase, 'done');
    assert.equal(status?.conceptCount, 2);
    assert.deepEqual(status?.findings, [
      {
        type: 'missing-link',
        message: 'Alpha should link Beta',
        conceptIds: ['c-a', 'c-b'],
      },
    ]);
  });

  assert.equal(sawRequest, true);
});

test(
  'lint-worker completes empty runs without calling the LLM',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const mockFetch: typeof fetch = async () => {
      throw new Error('fetch should not be called for an empty lint run');
    };

    await withMockFetch(mockFetch, async () => {
      const { createLintRun, getLintRunStatus, startLintWorker } = await import('./lint-worker');
      const runId = createLintRun();
      startLintWorker(runId);
      await waitForLintRunDone(runId);

      const status = getLintRunStatus(runId);
      assert.equal(status?.status, 'done');
      assert.equal(status?.conceptCount, 0);
      assert.deepEqual(status?.findings, []);
    });
  },
);

test(
  'lint-worker requests a larger token budget for reasoning-model deep checks',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    process.env.LLM_MODEL = 'minimax/minimax-m2.7';
    await seedConcepts();

    const mockFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'minimax/minimax-m2.7');
      assert.ok(body.max_tokens >= 4000);
      return new Response(
        [
          `data: ${JSON.stringify({
            choices: [{ delta: { content: JSON.stringify({ findings: [] }) } }],
          })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await withMockFetch(mockFetch, async () => {
      const { createLintRun, getLintRunStatus, startLintWorker } = await import('./lint-worker');
      const runId = createLintRun();
      startLintWorker(runId);
      await waitForLintRunDone(runId);

      const status = getLintRunStatus(runId);
      assert.equal(status?.status, 'done');
    });
  },
);

test(
  'lint-worker batches large concept sets before LLM analysis',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    process.env.COMPOUND_LINT_BATCH_SIZE = '2';
    await seedConcepts(5);

    const requestedPrompts: string[] = [];
    const mockFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requestedPrompts.push(body.messages[1].content);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify({ findings: [] }) },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    await withMockFetch(mockFetch, async () => {
      const { createLintRun, getLintRunStatus, startLintWorker } = await import('./lint-worker');
      const runId = createLintRun();
      startLintWorker(runId);
      await waitForLintRunDone(runId);

      const status = getLintRunStatus(runId);
      assert.equal(status?.status, 'done');
    });

    assert.equal(requestedPrompts.length, 3);
    for (const prompt of requestedPrompts) {
      assert.ok((prompt.match(/^\[c-\d+\]/gm) ?? []).length <= 2);
    }
  },
);
