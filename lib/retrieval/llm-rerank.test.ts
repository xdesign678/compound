import test from 'node:test';
import assert from 'node:assert/strict';

import { llmRerank } from './llm-rerank';

test('llmRerank returns empty for empty candidates', async () => {
  const r = await llmRerank({ query: 'x', candidates: [] });
  assert.deepEqual(r.ranked, []);
  assert.equal(r.used, 'fallback');
});

test('llmRerank passes through when env disables it', async () => {
  process.env.COMPOUND_RERANK = 'off';
  try {
    const r = await llmRerank({
      query: 'x',
      candidates: [
        { id: '1', kind: 'concept', title: 'A', snippet: 'aa' },
        { id: '2', kind: 'concept', title: 'B', snippet: 'bb' },
      ],
      topK: 1,
    });
    assert.equal(r.used, 'fallback');
    assert.equal(r.ranked.length, 1);
    assert.equal(r.ranked[0].id, '1');
  } finally {
    delete process.env.COMPOUND_RERANK;
  }
});
