import test from 'node:test';
import assert from 'node:assert/strict';

import { generateClientRequestId, withRequestId, REQUEST_ID_HEADER } from './trace-client';

test('generateClientRequestId returns a non-empty unique string', () => {
  const a = generateClientRequestId();
  const b = generateClientRequestId();
  assert.ok(a.length > 0);
  assert.notEqual(a, b);
});

test('withRequestId injects an X-Request-ID when missing', () => {
  const headers = withRequestId({ 'Content-Type': 'application/json' });
  assert.equal(headers['Content-Type'], 'application/json');
  assert.match(headers[REQUEST_ID_HEADER], /.+/);
});

test('withRequestId preserves a caller-provided request id (case-insensitive)', () => {
  const headers = withRequestId({ 'x-request-id': 'caller-supplied' });
  assert.equal(headers['x-request-id'], 'caller-supplied');
  assert.equal(headers[REQUEST_ID_HEADER], undefined);
});
