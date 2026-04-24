import test from 'node:test';
import assert from 'node:assert/strict';

import { chat } from './gateway';

async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T> | T
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

test('rejects custom api url without a user-provided api key', { concurrency: false }, async () => {
  await withEnv(
    {
      LLM_API_KEY: 'server-key',
      AI_GATEWAY_API_KEY: undefined,
    },
    async () => {
      await assert.rejects(
        chat({
          messages: [{ role: 'user', content: 'hi' }],
          llmConfig: { apiUrl: 'https://example.com/v1/chat/completions' },
        }),
        /user-provided API key/
      );
    }
  );
});

test('uses the user key for custom api urls instead of the server key', { concurrency: false }, async () => {
  let authorization = '';

  await withEnv(
    {
      LLM_API_KEY: 'server-key',
      AI_GATEWAY_API_KEY: undefined,
      COMPOUND_ALLOW_CUSTOM_LLM_API_URL: undefined,
      COMPOUND_SKIP_DNS_GUARD: 'true',
    },
    async () => {
      const mockFetch: typeof fetch = async (_input, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        authorization = headers?.Authorization ?? '';

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        );
      };

      await withMockFetch(mockFetch, async () => {
        const result = await chat({
          messages: [{ role: 'user', content: 'hi' }],
          llmConfig: {
            apiUrl: 'https://example.com/v1/chat/completions',
            apiKey: 'user-key',
          },
          maxTokens: 10,
        });

        assert.equal(result, 'ok');
        assert.equal(authorization, 'Bearer user-key');
      });
    }
  );
});

test('blocks private or loopback custom api urls', { concurrency: false }, async () => {
  await withEnv(
    {
      LLM_API_KEY: undefined,
      AI_GATEWAY_API_KEY: undefined,
    },
    async () => {
      await assert.rejects(
        chat({
          messages: [{ role: 'user', content: 'hi' }],
          llmConfig: {
            apiUrl: 'https://127.0.0.1/v1/chat/completions',
            apiKey: 'user-key',
          },
        }),
        /public HTTPS endpoint/
      );
    }
  );
});
