import test from 'node:test';
import assert from 'node:assert/strict';

import { contextualizeChunk } from './contextual-chunk';

test('contextualizeChunk returns empty when feature off', async () => {
  process.env.COMPOUND_CONTEXTUAL_RETRIEVAL = 'off';
  try {
    const r = await contextualizeChunk({
      fullDocument: 'x',
      documentTitle: 'y',
      chunk: 'z',
    });
    assert.equal(r, '');
  } finally {
    delete process.env.COMPOUND_CONTEXTUAL_RETRIEVAL;
  }
});

test('contextualizeChunk returns empty for empty chunk', async () => {
  const r = await contextualizeChunk({
    fullDocument: 'x',
    documentTitle: 'y',
    chunk: '   ',
  });
  assert.equal(r, '');
});
