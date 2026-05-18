import test from 'node:test';
import assert from 'node:assert/strict';

import { enforceContentLength, readJsonWithLimit, readLlmConfigOverride } from './request-guards';

test('rejects oversized request bodies', () => {
  const req = new Request('http://example.com/api/query', {
    headers: { 'content-length': '1025' },
  });

  const res = enforceContentLength(req, 1024);
  assert.equal(res?.status, 413);
});

test('readJsonWithLimit rejects oversized streamed bodies without content-length', async () => {
  const payload = JSON.stringify({ value: 'x'.repeat(2048) });
  const req = new Request('http://example.com/api/query', {
    method: 'POST',
    body: payload,
  });

  await assert.rejects(
    () => readJsonWithLimit(req, 1024),
    /Request body is too large\. Max 1024 bytes\./,
  );
});

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
