import test from 'node:test';
import assert from 'node:assert/strict';

import { contextualizeChunk } from './contextual-chunk';
import { resetCircuitBreakersForTests } from './circuit-breaker';

async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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

test('contextualizeChunk returns empty when feature off', async () => {
  process.env.COMPOUND_CONTEXTUAL_RETRIEVAL = 'off';
  try {
    const r = await contextualizeChunk({
      fullDocument: 'x',
      documentTitle: 'y',
      chunk: 'z',
    });
    assert.equal(r, '');
  } finally {
    delete process.env.COMPOUND_CONTEXTUAL_RETRIEVAL;
  }
});

test('contextualizeChunk returns empty for empty chunk', async () => {
  const r = await contextualizeChunk({
    fullDocument: 'x',
    documentTitle: 'y',
    chunk: '   ',
  });
  assert.equal(r, '');
});

test(
  'contextualizeChunk does not release another call budget when aborted while queued',
  { concurrency: false },
  async () => {
    resetCircuitBreakersForTests();

    let releaseFirst!: () => void;
    let firstFetchStarted!: () => void;
    const firstFetchStartedPromise = new Promise<void>((resolve) => {
      firstFetchStarted = resolve;
    });
    const releaseFirstPromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let activeFetches = 0;
    let maxActiveFetches = 0;

    const mockFetch: typeof fetch = async () => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      firstFetchStarted();
      await releaseFirstPromise;
      activeFetches -= 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: '上下文前缀' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await withEnv(
      {
        COMPOUND_CONTEXTUAL_RETRIEVAL: 'on',
        COMPOUND_SKIP_DNS_GUARD: 'true',
        LLM_API_KEY: 'test-key',
        LLM_API_URL: 'https://example.com/v1/chat/completions',
      },
      async () => {
        await withMockFetch(mockFetch, async () => {
          const first = contextualizeChunk({
            fullDocument: 'full document',
            documentTitle: 'doc',
            chunk: 'first chunk',
          });
          await firstFetchStartedPromise;

          const controller = new AbortController();
          controller.abort();
          const queuedAbort = contextualizeChunk({
            fullDocument: 'full document',
            documentTitle: 'doc',
            chunk: 'queued chunk',
            signal: controller.signal,
          });
          assert.equal(await queuedAbort, '');

          const third = contextualizeChunk({
            fullDocument: 'full document',
            documentTitle: 'doc',
            chunk: 'third chunk',
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          assert.equal(maxActiveFetches, 1);

          releaseFirst();
          assert.equal(await first, '上下文前缀');
          assert.equal(await third, '上下文前缀');
          assert.equal(maxActiveFetches, 1);
        });
      },
    );
  },
);
