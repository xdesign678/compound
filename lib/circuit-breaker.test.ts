import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CircuitBreakerOpenError,
  createCircuitBreaker,
  resetCircuitBreakersForTests,
} from './circuit-breaker';

test('opens after repeated failures and short-circuits later calls', async () => {
  resetCircuitBreakersForTests();
  let now = 1_000;
  let calls = 0;
  const breaker = createCircuitBreaker({
    name: 'test-short-circuit',
    failureThreshold: 2,
    resetTimeoutMs: 1_000,
    now: () => now,
  });

  await assert.rejects(
    breaker.execute(async () => {
      calls += 1;
      throw new Error('upstream down');
    }),
    /upstream down/,
  );
  await assert.rejects(
    breaker.execute(async () => {
      calls += 1;
      throw new Error('upstream still down');
    }),
    /upstream still down/,
  );

  await assert.rejects(
    breaker.execute(async () => {
      calls += 1;
      return 'should not run';
    }),
    CircuitBreakerOpenError,
  );
  assert.equal(calls, 2);
  assert.equal(breaker.snapshot().state, 'open');

  now += 1_001;
  const recovered = await breaker.execute(async () => {
    calls += 1;
    return 'recovered';
  });

  assert.equal(recovered, 'recovered');
  assert.equal(calls, 3);
  assert.equal(breaker.snapshot().state, 'closed');
});

test('does not count caller-classified non-retryable errors as breaker failures', async () => {
  resetCircuitBreakersForTests();
  const breaker = createCircuitBreaker({
    name: 'test-non-retryable',
    failureThreshold: 1,
    resetTimeoutMs: 1_000,
    isFailure: (error) => error instanceof Error && !error.message.includes('bad request'),
  });

  await assert.rejects(
    breaker.execute(async () => {
      throw new Error('bad request');
    }),
    /bad request/,
  );

  assert.equal(breaker.snapshot().state, 'closed');
});
