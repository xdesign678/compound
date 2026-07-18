import test from 'node:test';
import assert from 'node:assert/strict';

import { contextualizeChunk, contextualizeChunkBatch } from './contextual-chunk';
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

    let releaseFetches!: () => void;
    let firstTwoFetchesStarted!: () => void;
    const firstTwoFetchesStartedPromise = new Promise<void>((resolve) => {
      firstTwoFetchesStarted = resolve;
    });
    const releaseFetchesPromise = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    let startedFetches = 0;
    let activeFetches = 0;
    let maxActiveFetches = 0;

    const mockFetch: typeof fetch = async () => {
      startedFetches += 1;
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      if (startedFetches === 2) firstTwoFetchesStarted();
      await releaseFetchesPromise;
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
          const second = contextualizeChunk({
            fullDocument: 'full document',
            documentTitle: 'doc',
            chunk: 'second chunk',
          });
          await firstTwoFetchesStartedPromise;

          try {
            const controller = new AbortController();
            const queuedAbort = contextualizeChunk({
              fullDocument: 'full document',
              documentTitle: 'doc',
              chunk: 'queued chunk',
              signal: controller.signal,
            });
            await new Promise((resolve) => setTimeout(resolve, 20));
            controller.abort();
            assert.equal(await queuedAbort, '');

            const fourth = contextualizeChunk({
              fullDocument: 'full document',
              documentTitle: 'doc',
              chunk: 'fourth chunk',
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            assert.equal(maxActiveFetches, 2);

            releaseFetches();
            assert.equal(await first, '上下文前缀');
            assert.equal(await second, '上下文前缀');
            assert.equal(await fourth, '上下文前缀');
            assert.equal(maxActiveFetches, 2);
          } finally {
            releaseFetches();
          }
        });
      },
    );
  },
);

test('contextualizeChunkBatch requests multiple prefixes in one chat call', async () => {
  resetCircuitBreakersForTests();
  const requests: unknown[] = [];
  const mockFetch: typeof fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                'chunk-1': '第一段上下文',
                'chunk-2': '第二段上下文',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
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
        const prefixes = await contextualizeChunkBatch({
          fullDocument: '# Doc\n\nFull body',
          documentTitle: 'Doc',
          chunks: [
            { id: 'chunk-1', content: 'first chunk' },
            { id: 'chunk-2', content: 'second chunk' },
          ],
        });

        assert.equal(requests.length, 1);
        assert.equal(prefixes.get('chunk-1'), '第一段上下文');
        assert.equal(prefixes.get('chunk-2'), '第二段上下文');
        const body = requests[0] as {
          messages: Array<{ cache_control?: { type: string }; content: string }>;
        };
        assert.deepEqual(body.messages[0]?.cache_control, { type: 'ephemeral' });
        assert.match(body.messages[1]?.content ?? '', /chunk-1/);
      });
    },
  );
});
