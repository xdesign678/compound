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

test('publicQueryErrorMessage redacts bearer-like secrets from explainable errors', () => {
  const message = publicQueryErrorMessage(
    new Error('Gateway 500: Authorization Bearer secret-token-value-123456 failed'),
  );
  assert.match(message, /Bearer \[redacted\]/);
  assert.doesNotMatch(message, /secret-token-value/);
});
