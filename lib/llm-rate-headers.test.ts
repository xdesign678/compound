import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRateLimitBackoffMs } from './llm-rate-headers';

test('parseRateLimitBackoffMs prefers retry-after seconds', () => {
  const headers = new Headers({ 'retry-after': '3' });

  assert.equal(parseRateLimitBackoffMs(headers, { nowMs: 1_000 }), 3_000);
});

test('parseRateLimitBackoffMs parses retry-after dates', () => {
  const headers = new Headers({ 'retry-after': new Date(10_000).toUTCString() });

  assert.equal(parseRateLimitBackoffMs(headers, { nowMs: 1_000 }), 9_000);
});

test('parseRateLimitBackoffMs pauses when remaining quota is below threshold', () => {
  const headers = new Headers({
    'x-ratelimit-remaining': '1',
    'x-ratelimit-reset': '7',
  });

  assert.equal(
    parseRateLimitBackoffMs(headers, {
      nowMs: 1_000,
      remainingThreshold: 2,
      defaultBackoffMs: 5_000,
    }),
    6_000,
  );
});

test('parseRateLimitBackoffMs returns null when quota is healthy', () => {
  const headers = new Headers({ 'x-ratelimit-remaining': '20' });

  assert.equal(parseRateLimitBackoffMs(headers, { remainingThreshold: 2 }), null);
});

test('parseRateLimitBackoffMs returns null when rate-limit headers are absent', () => {
  assert.equal(parseRateLimitBackoffMs(new Headers()), null);
});
