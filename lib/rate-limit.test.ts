import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tests use spoofed x-forwarded-for headers to simulate distinct clients —
// that only works when the rate limiter is told to trust the proxy chain.
process.env.COMPOUND_TRUST_PROXY = 'true';
// Set deterministic auth/webhook limits for testing
process.env.COMPOUND_AUTH_RATE_LIMIT = '5';
process.env.COMPOUND_WEBHOOK_RATE_LIMIT = '10';

import {
  rateLimit,
  rateLimitCheck,
  rateLimitIncrement,
  rateLimitReset,
  authRateLimitCheck,
  authRateLimitFail,
  authRateLimitReset,
  webhookRateLimit,
} from './rate-limit';

function resetRateLimitStore() {
  globalThis._compoundRateLimitStore = undefined;
  globalThis._compoundRateLimitGcAt = undefined;
}

function makeReq(ip: string): Request {
  return new Request('http://example.com/api/test', {
    headers: { 'x-forwarded-for': ip },
  });
}

// ─── Existing rateLimit() tests ────────────────────────────────────────

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

// ─── rateLimitCheck(): read-only, no increment ─────────────────────────

test('rateLimitCheck returns null when no bucket exists', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.1');
  assert.equal(rateLimitCheck(req, 'chk', { limit: 3, windowMs: 60_000 }), null);
});

test('rateLimitCheck returns null when under limit', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.2');
  // Pre-fill the bucket via rateLimit (which increments)
  rateLimit(req, 'chk', { limit: 3, windowMs: 60_000 });
  // Check should pass (count=1, limit=3)
  assert.equal(rateLimitCheck(req, 'chk', { limit: 3, windowMs: 60_000 }), null);
});

test('rateLimitCheck returns 429 when over limit without incrementing', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.3');
  // Fill the bucket past the limit
  rateLimit(req, 'chk', { limit: 2, windowMs: 60_000 }); // count=1
  rateLimit(req, 'chk', { limit: 2, windowMs: 60_000 }); // count=2
  rateLimit(req, 'chk', { limit: 2, windowMs: 60_000 }); // count=3 → 429
  // Now check should return 429
  const blocked = rateLimitCheck(req, 'chk', { limit: 2, windowMs: 60_000 });
  assert.equal(blocked?.status, 429);
  // Check did NOT increment (count should still be 3)
  const store = globalThis._compoundRateLimitStore!;
  const bucket = store.get('chk:10.0.0.3')!;
  assert.equal(bucket.count, 3, 'rateLimitCheck should not increment the counter');
});

test('rateLimitCheck returns null for expired bucket', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.4');
  // Create a bucket that's already expired
  const store = (globalThis._compoundRateLimitStore ??= new Map());
  store.set('chk:10.0.0.4', { count: 999, resetAt: Date.now() - 1 });
  assert.equal(rateLimitCheck(req, 'chk', { limit: 2, windowMs: 60_000 }), null);
});

// ─── rateLimitIncrement(): only increments, for counting failures ──────

test('rateLimitIncrement starts a new bucket on first call', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.10');
  assert.equal(rateLimitIncrement(req, 'inc', { limit: 3, windowMs: 60_000 }), null);
  const store = globalThis._compoundRateLimitStore!;
  assert.equal(store.get('inc:10.0.0.10')?.count, 1);
});

test('rateLimitIncrement increments existing bucket', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.11');
  rateLimitIncrement(req, 'inc', { limit: 3, windowMs: 60_000 }); // count=1
  rateLimitIncrement(req, 'inc', { limit: 3, windowMs: 60_000 }); // count=2
  assert.equal(rateLimitIncrement(req, 'inc', { limit: 3, windowMs: 60_000 }), null); // count=3
  const store = globalThis._compoundRateLimitStore!;
  assert.equal(store.get('inc:10.0.0.11')?.count, 3);
});

test('rateLimitIncrement returns 429 when exceeding limit', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.12');
  const limit = 3;
  for (let i = 0; i < limit; i++) {
    assert.equal(rateLimitIncrement(req, 'inc', { limit, windowMs: 60_000 }), null);
  }
  // Next increment should exceed limit
  const blocked = rateLimitIncrement(req, 'inc', { limit, windowMs: 60_000 });
  assert.equal(blocked?.status, 429);
});

test('rateLimitIncrement 429 includes Retry-After header and body field', async () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.13');
  const limit = 1;
  rateLimitIncrement(req, 'inc', { limit, windowMs: 60_000 }); // count=1
  const blocked = rateLimitIncrement(req, 'inc', { limit, windowMs: 60_000 }); // 429
  assert.equal(blocked?.status, 429);
  assert.ok(blocked!.headers.has('retry-after'), '429 must have Retry-After header');
  const body = (await blocked!.json()) as { error: string; retryAfter: number };
  assert.ok(body.retryAfter >= 1, 'body.retryAfter must be >= 1');
});

// ─── rateLimitReset(): clears bucket ───────────────────────────────────

test('rateLimitReset clears the bucket for the scope+client', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.20');
  rateLimit(req, 'rst', { limit: 5, windowMs: 60_000 });
  rateLimit(req, 'rst', { limit: 5, windowMs: 60_000 });
  const store = globalThis._compoundRateLimitStore!;
  assert.ok(store.has('rst:10.0.0.20'), 'bucket exists before reset');
  rateLimitReset(req, 'rst');
  assert.ok(!store.has('rst:10.0.0.20'), 'bucket removed after reset');
});

test('rateLimitReset allows fresh start after being blocked', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.21');
  // Exceed limit
  rateLimit(req, 'rst', { limit: 1, windowMs: 60_000 }); // count=1
  rateLimit(req, 'rst', { limit: 1, windowMs: 60_000 }); // count=2 → 429
  // Reset
  rateLimitReset(req, 'rst');
  // Should be allowed again
  assert.equal(rateLimit(req, 'rst', { limit: 1, windowMs: 60_000 }), null);
});

// ─── Auth rate limit (check → fail → reset) ───────────────────────────

test('authRateLimitCheck returns null when no failures recorded', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.30');
  assert.equal(authRateLimitCheck(req), null);
});

test('authRateLimitFail counts only failures — sequential failed logins eventually trigger 429', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.31');
  // COMPOUND_AUTH_RATE_LIMIT=5 (set above)
  for (let i = 0; i < 5; i++) {
    assert.equal(authRateLimitCheck(req), null, `check ${i + 1} should not be blocked`);
    assert.equal(authRateLimitFail(req), null, `fail ${i + 1} should not yet be 429`);
  }
  // 6th failure: check still passes (count=5, limit=5), but fail triggers 429
  assert.equal(authRateLimitCheck(req), null, 'check still under limit');
  const blocked = authRateLimitFail(req);
  assert.equal(blocked?.status, 429, '6th failure should return 429');
  assert.ok(blocked!.headers.has('retry-after'), '429 must have Retry-After header');
});

test('authRateLimitCheck blocks after too many failures', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.32');
  // Exceed limit
  for (let i = 0; i < 6; i++) authRateLimitFail(req);
  // Now check should block
  assert.equal(authRateLimitCheck(req)?.status, 429);
});

test('authRateLimitReset clears failure history after successful auth', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.33');
  // Accumulate some failures
  for (let i = 0; i < 4; i++) authRateLimitFail(req);
  // Successful auth resets
  authRateLimitReset(req);
  // Should be allowed again
  assert.equal(authRateLimitCheck(req), null);
  assert.equal(authRateLimitFail(req), null);
});

test('auth rate limit is per-client (different IPs have independent counters)', () => {
  resetRateLimitStore();
  const reqA = makeReq('10.0.0.40');
  const reqB = makeReq('10.0.0.41');
  // Client A exceeds limit
  for (let i = 0; i < 6; i++) authRateLimitFail(reqA);
  assert.equal(authRateLimitCheck(reqA)?.status, 429, 'client A is blocked');
  // Client B is not affected
  assert.equal(authRateLimitCheck(reqB), null, 'client B is not blocked');
});

// ─── Webhook rate limit (counts all requests) ──────────────────────────

test('webhookRateLimit counts every request and blocks at limit', () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.50');
  // COMPOUND_WEBHOOK_RATE_LIMIT=10 (set above)
  for (let i = 0; i < 10; i++) {
    assert.equal(webhookRateLimit(req), null, `request ${i + 1} should pass`);
  }
  assert.equal(webhookRateLimit(req)?.status, 429, '11th request should be 429');
});

test('webhookRateLimit 429 includes Retry-After', async () => {
  resetRateLimitStore();
  const req = makeReq('10.0.0.51');
  for (let i = 0; i < 11; i++) webhookRateLimit(req);
  const blocked = webhookRateLimit(req);
  assert.equal(blocked?.status, 429);
  assert.ok(blocked!.headers.has('retry-after'));
  const body = (await blocked!.json()) as { retryAfter: number };
  assert.ok(body.retryAfter >= 1);
});

test('webhook rate limit is per-client', () => {
  resetRateLimitStore();
  const reqA = makeReq('10.0.0.52');
  const reqB = makeReq('10.0.0.53');
  for (let i = 0; i < 11; i++) webhookRateLimit(reqA);
  assert.equal(webhookRateLimit(reqA)?.status, 429, 'client A blocked');
  assert.equal(webhookRateLimit(reqB), null, 'client B not blocked');
});

test('sqlite rate-limit backend survives in-memory store resets', async (t) => {
  const previousBackend = process.env.COMPOUND_RATE_LIMIT_BACKEND;
  const previousDataDir = process.env.DATA_DIR;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-rate-limit-'));
  process.env.COMPOUND_RATE_LIMIT_BACKEND = 'sqlite';
  process.env.DATA_DIR = tempDir;
  const closeDb = () => {
    const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
      | { db?: { close?: () => void } }
      | undefined;
    holder?.db?.close?.();
    delete (globalThis as Record<string, unknown>).__compound_sqlite__;
  };
  t.after(() => {
    closeDb();
    if (previousBackend === undefined) delete process.env.COMPOUND_RATE_LIMIT_BACKEND;
    else process.env.COMPOUND_RATE_LIMIT_BACKEND = previousBackend;
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  closeDb();
  const req = makeReq('10.0.0.60');
  assert.equal(rateLimit(req, 'persistent', { limit: 1, windowMs: 60_000 }), null);
  assert.equal(rateLimit(req, 'persistent', { limit: 1, windowMs: 60_000 })?.status, 429);

  resetRateLimitStore();
  assert.equal(rateLimitCheck(req, 'persistent', { limit: 1, windowMs: 60_000 })?.status, 429);

  const { getServerDb } = await import('./server-db');
  const row = getServerDb()
    .prepare(`SELECT count FROM rate_limit_buckets WHERE key = 'persistent:10.0.0.60'`)
    .get() as { count: number };
  assert.equal(row.count, 2);
});
