import test from 'node:test';
import assert from 'node:assert/strict';

import { CircuitBreakerOpenError, resetCircuitBreakersForTests } from './circuit-breaker';
import { chat, fetchPublicHttpsApi, isReasoningModel } from './gateway';
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

test('does not treat DeepSeek V4 Flash as a reasoning-only model', () => {
  assert.equal(isReasoningModel('deepseek/deepseek-v4-flash'), false);
  assert.equal(isReasoningModel('deepseek/deepseek-r1'), true);
});

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
  'safe API fetch follows only same-origin 307/308 redirects',
  { concurrency: false },
  async () => {
    const requested: string[] = [];
    await withEnv({ COMPOUND_SKIP_DNS_GUARD: 'true' }, async () => {
      await withMockFetch(
        (async (input) => {
          requested.push(String(input));
          if (requested.length === 1) {
            return new Response(null, {
              status: 307,
              headers: { location: '/v2/chat/completions' },
            });
          }
          return new Response('{}', { status: 200 });
        }) as typeof fetch,
        async () => {
          const response = await fetchPublicHttpsApi('https://example.com/v1/chat/completions', {
            method: 'POST',
            body: '{}',
          });
          assert.equal(response.status, 200);
        },
      );
    });
    assert.deepEqual(requested, [
      'https://example.com/v1/chat/completions',
      'https://example.com/v2/chat/completions',
    ]);
  },
);

test(
  'safe API fetch rejects cross-origin redirects before forwarding credentials',
  { concurrency: false },
  async () => {
    let requests = 0;
    await withEnv({ COMPOUND_SKIP_DNS_GUARD: 'true' }, async () => {
      await withMockFetch(
        (async () => {
          requests += 1;
          return new Response(null, {
            status: 307,
            headers: { location: 'https://other.example.test/private' },
          });
        }) as typeof fetch,
        async () => {
          await assert.rejects(
            fetchPublicHttpsApi('https://example.com/v1/chat/completions', {
              headers: { Authorization: 'Bearer secret' },
            }),
            /different origin/,
          );
        },
      );
    });
    assert.equal(requests, 1);
  },
);

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

test(
  'chat propagates caller abort signal to the underlying fetch',
  { concurrency: false },
  async () => {
    await withEnv(
      {
        LLM_API_KEY: 'server-key',
        LLM_API_URL: 'https://example.com/v1/chat/completions',
        AI_GATEWAY_API_KEY: undefined,
        COMPOUND_SKIP_DNS_GUARD: 'true',
      },
      async () => {
        const controller = new AbortController();
        let sawAbort = false;
        const mockFetch: typeof fetch = async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) {
              sawAbort = true;
              reject(init.signal.reason ?? new DOMException('aborted', 'AbortError'));
              return;
            }
            init?.signal?.addEventListener('abort', () => {
              sawAbort = true;
              reject(init.signal?.reason ?? new DOMException('aborted', 'AbortError'));
            });
          });

        await withMockFetch(mockFetch, async () => {
          const promise = chat({
            messages: [{ role: 'user', content: 'hi' }],
            maxTokens: 10,
            signal: controller.signal,
          });
          controller.abort(new DOMException('user cancelled', 'AbortError'));
          await assert.rejects(promise, /user cancelled|AbortError|aborted/);
          assert.equal(sawAbort, true);
        });
      },
    );
  },
);

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
  'non-streaming chat converts non-JSON 200 body into typed GatewayResponseError',
  { concurrency: false },
  async () => {
    await withEnv(
      {
        LLM_API_KEY: 'server-key',
        LLM_API_URL: 'https://example.com/v1/chat/completions',
        AI_GATEWAY_API_KEY: undefined,
        COMPOUND_SKIP_DNS_GUARD: 'true',
      },
      async () => {
        const mockFetch: typeof fetch = async () =>
          new Response('This is not JSON at all', {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          });

        await withMockFetch(mockFetch, async () => {
          await assert.rejects(
            chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
            (err: unknown) => {
              assert.ok(err instanceof Error);
              assert.equal(err.name, 'GatewayResponseError');
              assert.match(err.message, /non-JSON body/i);
              return true;
            },
          );
        });
      },
    );
  },
);

test(
  'non-streaming chat aborts when body read hangs beyond wall-clock timeout',
  { concurrency: false },
  async () => {
    await withEnv(
      {
        LLM_API_KEY: 'server-key',
        LLM_API_URL: 'https://example.com/v1/chat/completions',
        AI_GATEWAY_API_KEY: undefined,
        COMPOUND_SKIP_DNS_GUARD: 'true',
        // Use a very short wall-clock timeout so the test finishes quickly
        COMPOUND_LLM_TIMEOUT_MS: '500',
        COMPOUND_LLM_REASONING_EXTRA_MS: '0',
      },
      async () => {
        // Mock fetch that returns 200 but whose body stream never completes
        const mockFetch: typeof fetch = async () => {
          // Create a ReadableStream that never resolves
          const body = new ReadableStream({
            start() {
              // Intentionally never call controller.close() or controller.enqueue()
              // This simulates a hanging body read
            },
          });
          return new Response(body, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        };

        await withMockFetch(mockFetch, async () => {
          const start = Date.now();
          await assert.rejects(
            chat({
              messages: [{ role: 'user', content: 'hi' }],
              maxTokens: 10,
              // Use a non-reasoning model so wallClockTimeout = LLM_TIMEOUT_MS = 500ms
              model: 'gpt-4o-mini',
            }),
            (err: unknown) => {
              assert.ok(err instanceof Error);
              // Should be a timeout error, not a hang
              const text = `${err.name}|${err.message}`.toLowerCase();
              assert.ok(
                text.includes('timeout') || text.includes('aborted') || text.includes('exceeded'),
                `Expected timeout/abort error, got: ${err.name}: ${err.message}`,
              );
              return true;
            },
          );
          const elapsed = Date.now() - start;
          // Should have timed out within a reasonable window (not hang forever)
          assert.ok(elapsed < 5_000, `Took too long (${elapsed}ms), may be hanging`);
        });
      },
    );
  },
);

test('non-streaming chat aborts body read on caller signal', { concurrency: false }, async () => {
  await withEnv(
    {
      LLM_API_KEY: 'server-key',
      LLM_API_URL: 'https://example.com/v1/chat/completions',
      AI_GATEWAY_API_KEY: undefined,
      COMPOUND_SKIP_DNS_GUARD: 'true',
      // Set a long wall-clock timeout so the caller abort fires first
      COMPOUND_LLM_TIMEOUT_MS: '30000',
      COMPOUND_LLM_REASONING_EXTRA_MS: '0',
    },
    async () => {
      const controller = new AbortController();
      const mockFetch: typeof fetch = async () => {
        const body = new ReadableStream({
          start() {
            // Never resolves — simulates a hanging body read
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };

      await withMockFetch(mockFetch, async () => {
        const promise = chat({
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens: 10,
          model: 'gpt-4o-mini',
          signal: controller.signal,
        });
        // Abort after a short delay (before wall-clock timeout)
        setTimeout(
          () => controller.abort(new DOMException('client disconnected', 'AbortError')),
          200,
        );
        const start = Date.now();
        await assert.rejects(promise, /client disconnected|AbortError|aborted/);
        const elapsed = Date.now() - start;
        // Should abort quickly (< 2s), not wait for the 30s wall-clock timeout
        assert.ok(elapsed < 2_000, `Abort took too long (${elapsed}ms)`);
      });
    },
  );
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

test(
  'model output truncation does not open the gateway circuit',
  { concurrency: false },
  async () => {
    resetCircuitBreakersForTests();
    let fetchCalls = 0;

    await withEnv(
      {
        LLM_API_KEY: 'server-key',
        LLM_API_URL: 'https://example.com/v1/chat/completions',
        AI_GATEWAY_API_KEY: undefined,
        COMPOUND_SKIP_DNS_GUARD: 'true',
        COMPOUND_LLM_CIRCUIT_FAILURE_THRESHOLD: '2',
      },
      async () => {
        const mockFetch: typeof fetch = async () => {
          fetchCalls += 1;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: fetchCalls === 2 ? '{"items":[' : null },
                  finish_reason: 'length',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        };

        await withMockFetch(mockFetch, async () => {
          for (let i = 0; i < 3; i += 1) {
            await assert.rejects(
              chat({
                messages: [{ role: 'user', content: 'hi' }],
                model: 'openai/gpt-4o-mini',
                maxTokens: 10,
                responseFormat: 'json_object',
              }),
              /budget exhausted|truncated|finish_reason=length/i,
            );
          }
        });
      },
    );

    assert.equal(fetchCalls, 3, 'every request reaches the provider instead of short-circuiting');
  },
);

test('caller-style aborts do not open the gateway circuit', { concurrency: false }, async () => {
  resetCircuitBreakersForTests();
  let fetchCalls = 0;

  await withEnv(
    {
      LLM_API_KEY: 'server-key',
      LLM_API_URL: 'https://example.com/v1/chat/completions',
      AI_GATEWAY_API_KEY: undefined,
      COMPOUND_SKIP_DNS_GUARD: 'true',
      COMPOUND_LLM_CIRCUIT_FAILURE_THRESHOLD: '2',
    },
    async () => {
      const mockFetch: typeof fetch = async () => {
        fetchCalls += 1;
        if (fetchCalls <= 2) throw new DOMException('user cancelled', 'AbortError');
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      };

      await withMockFetch(mockFetch, async () => {
        await assert.rejects(
          chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
          /user cancelled|AbortError/i,
        );
        await assert.rejects(
          chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
          /user cancelled|AbortError/i,
        );
        assert.equal(
          await chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }),
          'ok',
        );
      });
    },
  );

  assert.equal(fetchCalls, 3);
});

test('reports reasoning-only provider responses separately from generic shape errors', async () => {
  resetCircuitBreakersForTests();
  await withEnv(
    {
      LLM_API_KEY: 'server-key',
      LLM_API_URL: 'https://example.com/v1/chat/completions',
      AI_GATEWAY_API_KEY: undefined,
      COMPOUND_SKIP_DNS_GUARD: 'true',
    },
    async () => {
      await withMockFetch(
        async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: null, reasoning: 'internal reasoning consumed the budget' },
                  finish_reason: null,
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        async () => {
          await assert.rejects(
            chat({
              messages: [{ role: 'user', content: 'hi' }],
              model: 'openai/gpt-4o-mini',
              maxTokens: 10,
            }),
            /reasoning without content.*increase max_tokens/i,
          );
        },
      );
    },
  );
});
