import test from 'node:test';
import assert from 'node:assert/strict';

import { rateLimit } from './rate-limit';

function resetRateLimitStore() {
  globalThis.__compoundRateLimitStore = undefined;
}

test('blocks requests after the limit is exceeded', () => {
  resetRateLimitStore();
  const req = new Request('http://example.com/api/query', {
    headers: { 'x-forwarded-for': '1.2.3.4' },
  });

  assert.equal(rateLimit(req, 'test', { limit: 2, windowMs: 60_000 }), null);
  assert.equal(rateLimit(req, 'test', { limit: 2, windowMs: 60_000 }), null);
  assert.equal(rateLimit(req, 'test', { limit: 2, windowMs: 60_000 })?.status, 429);
});

test('tracks rate limits per client', () => {
  resetRateLimitStore();
  const reqA = new Request('http://example.com/api/query', {
    headers: { 'x-forwarded-for': '1.2.3.4' },
  });
  const reqB = new Request('http://example.com/api/query', {
    headers: { 'x-forwarded-for': '5.6.7.8' },
  });

  assert.equal(rateLimit(reqA, 'test', { limit: 1, windowMs: 60_000 }), null);
  assert.equal(rateLimit(reqB, 'test', { limit: 1, windowMs: 60_000 }), null);
  assert.equal(rateLimit(reqA, 'test', { limit: 1, windowMs: 60_000 })?.status, 429);
});
