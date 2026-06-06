import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyQueryError, publicQueryErrorMessage } from './query-errors';

test('classifyQueryError groups synthesis timeout failures', () => {
  const error = new DOMException('LLM call exceeded wall-clock budget', 'TimeoutError');
  assert.equal(classifyQueryError(error), 'timeout');
});

test('classifyQueryError groups malformed synthesis JSON as parse', () => {
  assert.equal(classifyQueryError(new Error('Unexpected gateway response shape')), 'parse');
});

test('publicQueryErrorMessage returns generic message — never leaks internals', () => {
  const message = publicQueryErrorMessage(
    new Error('Gateway 500: Authorization Bearer secret-token-value-123456 failed'),
  );
  assert.equal(message, 'Internal server error');
  assert.doesNotMatch(message, /Bearer/);
  assert.doesNotMatch(message, /secret-token-value/);
  assert.doesNotMatch(message, /Gateway/);
});
