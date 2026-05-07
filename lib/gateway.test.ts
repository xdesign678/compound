import test from 'node:test';
import assert from 'node:assert/strict';

import { CircuitBreakerOpenError, resetCircuitBreakersForTests } from './circuit-breaker';
import { chat } from './gateway';
import {
  renderPrometheusMetrics,
  resetPrometheusMetricsForTests,
} from './observability/prometheus';

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
        /user-provided API key/,
      );
    },
  );
});

test(
  'uses the user key for custom api urls instead of the server key',
  { concurrency: false },
  async () => {
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
            },
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
      },
    );
  },
);

test('trims server api url and honors legacy gateway url', { concurrency: false }, async () => {
  let requestedUrl = '';
  let requestedModel = '';

  await withEnv(
    {
      LLM_API_KEY: undefined,
      LLM_API_URL: undefined,
      LLM_MODEL: ' "legacy-model" ',
      AI_GATEWAY_API_KEY: 'legacy-key',
      AI_GATEWAY_URL: ' "https://legacy.example.com/v1/chat/completions" ',
      COMPOUND_SKIP_DNS_GUARD: 'true',
    },
    async () => {
      const mockFetch: typeof fetch = async (input, init) => {
        requestedUrl = String(input);
        requestedModel = JSON.parse(String(init?.body ?? '{}')).model;

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      };

      await withMockFetch(mockFetch, async () => {
        const result = await chat({
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens: 10,
        });

        assert.equal(result, 'ok');
        assert.equal(requestedUrl, 'https://legacy.example.com/v1/chat/completions');
        assert.equal(requestedModel, 'legacy-model');
      });
    },
  );
});

test('blocks private or loopback custom api urls', { concurrency: false }, async () => {
  resetPrometheusMetricsForTests();

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
        /public HTTPS endpoint/,
      );
    },
  );

  const metrics = renderPrometheusMetrics();
  assert.match(metrics, /compound_llm_ssrf_blocks_total\{host="127\.0\.0\.1"\} 1/);
});

test(
  'opens a circuit after repeated transient gateway failures and exposes recovery metrics',
  { concurrency: false },
  async () => {
    resetCircuitBreakersForTests();
    resetPrometheusMetricsForTests();
    let fetchCalls = 0;
    let shouldRecover = false;

    await withEnv(
      {
        LLM_API_KEY: 'server-key',
        AI_GATEWAY_API_KEY: undefined,
        COMPOUND_SKIP_DNS_GUARD: 'true',
        COMPOUND_LLM_CIRCUIT_FAILURE_THRESHOLD: '2',
        COMPOUND_LLM_CIRCUIT_RESET_MS: '100',
      },
      async () => {
        const mockFetch: typeof fetch = async () => {
          fetchCalls += 1;
          if (shouldRecover) {
            return new Response(
              JSON.stringify({
                choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }],
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            );
          }
          return new Response('temporary outage', { status: 503 });
        };

        await withMockFetch(mockFetch, async () => {
          for (let i = 0; i < 2; i += 1) {
            await assert.rejects(
              chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
              /Gateway 503/,
            );
          }

          await assert.rejects(
            chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
            CircuitBreakerOpenError,
          );

          let metrics = renderPrometheusMetrics();
          assert.match(metrics, /compound_llm_circuit_state\{host="openrouter\.ai"\} 2/);

          shouldRecover = true;
          await new Promise((resolve) => setTimeout(resolve, 120));

          const recovered = await chat({
            messages: [{ role: 'user', content: 'hi' }],
            maxTokens: 10,
          });

          metrics = renderPrometheusMetrics();
          assert.equal(recovered, 'recovered');
          assert.match(metrics, /compound_llm_circuit_state\{host="openrouter\.ai"\} 0/);
        });
      },
    );

    assert.equal(fetchCalls, 3);
  },
);
