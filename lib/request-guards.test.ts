import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
  readLlmConfigOverride,
  RequestBodyTooLargeError,
} from './request-guards';

// ── enforceContentLength ──

test('enforceContentLength returns 413 response when Content-Length exceeds max', () => {
  const req = new Request('http://example.com/api/query', {
    headers: { 'content-length': '1025' },
  });

  const res = enforceContentLength(req, 1024);
  assert.equal(res?.status, 413);
  // body is JSON with error message
  assert.ok(res, 'enforceContentLength should return a response');
});

test('enforceContentLength returns null when Content-Length is within limit', () => {
  const req = new Request('http://example.com/api/query', {
    headers: { 'content-length': '512' },
  });

  const res = enforceContentLength(req, 1024);
  assert.equal(res, null);
});

test('enforceContentLength returns null when Content-Length header is absent (chunked)', () => {
  const req = new Request('http://example.com/api/query', {
    method: 'POST',
    body: JSON.stringify({ data: 'x'.repeat(2048) }),
  });

  const res = enforceContentLength(req, 1024);
  assert.equal(res, null);
});

test('enforceContentLength returns null for non-finite Content-Length', () => {
  const req = new Request('http://example.com/api/query', {
    headers: { 'content-length': 'abc' },
  });

  const res = enforceContentLength(req, 1024);
  assert.equal(res, null);
});

// ── isRequestBodyTooLargeError ──

test('isRequestBodyTooLargeError returns true for RequestBodyTooLargeError', () => {
  const err = new RequestBodyTooLargeError(1024);
  assert.equal(isRequestBodyTooLargeError(err), true);
  assert.equal(err.status, 413);
  assert.ok(err.message.includes('1024'));
});

test('isRequestBodyTooLargeError returns false for regular Error', () => {
  const err = new Error('something else');
  assert.equal(isRequestBodyTooLargeError(err), false);
});

test('isRequestBodyTooLargeError returns false for non-Error values', () => {
  assert.equal(isRequestBodyTooLargeError(null), false);
  assert.equal(isRequestBodyTooLargeError(undefined), false);
  assert.equal(isRequestBodyTooLargeError('string'), false);
});

// ── readJsonWithLimit ──

test('readJsonWithLimit rejects oversized streamed bodies without content-length', async () => {
  const payload = JSON.stringify({ value: 'x'.repeat(2048) });
  const req = new Request('http://example.com/api/query', {
    method: 'POST',
    body: payload,
  });

  await assert.rejects(
    () => readJsonWithLimit(req, 1024),
    (err: unknown) => {
      assert.ok(isRequestBodyTooLargeError(err));
      assert.equal((err as RequestBodyTooLargeError).status, 413);
      return true;
    },
  );
});

test('readJsonWithLimit rejects oversized bodies with Content-Length header', async () => {
  const bigPayload = 'x'.repeat(2048);
  const req = new Request('http://example.com/api/query', {
    method: 'POST',
    headers: { 'content-length': String(bigPayload.length + 20) },
    body: bigPayload,
  });

  await assert.rejects(
    () => readJsonWithLimit(req, 1024),
    (err: unknown) => {
      assert.ok(isRequestBodyTooLargeError(err));
      return true;
    },
  );
});

test('readJsonWithLimit parses in-limit body correctly', async () => {
  const data = { hello: 'world', num: 42 };
  const req = new Request('http://example.com/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });

  const result = await readJsonWithLimit(req, 1024);
  assert.deepEqual(result, data);
});

test('readJsonWithLimit returns {} for empty body', async () => {
  const req = new Request('http://example.com/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });

  const result = await readJsonWithLimit(req, 1024);
  assert.deepEqual(result, {});
});

// ── readLlmConfigOverride ──

test('prefers header llm config overrides over request body', () => {
  const req = new Request('http://example.com/api/query', {
    headers: {
      'x-user-api-key': 'header-key',
      'x-user-api-url': 'https://example.com/v1/chat/completions',
      'x-user-model': 'header-model',
    },
  });

  const llmConfig = readLlmConfigOverride(req, {
    llmConfig: {
      apiKey: 'body-key',
      apiUrl: 'https://body.example.com/v1/chat/completions',
      model: 'body-model',
    },
  });

  assert.deepEqual(llmConfig, {
    apiKey: 'header-key',
    apiUrl: 'https://example.com/v1/chat/completions',
    model: 'header-model',
  });
});
