import test from 'node:test';
import assert from 'node:assert/strict';

import { llmRerank, resetRerankHealthForTests, setRerankGatewayForTests } from './llm-rerank';
import {
  renderPrometheusMetrics,
  resetPrometheusMetricsForTests,
} from '../observability/prometheus';

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

test('llmRerank cools down after sustained failures', async () => {
  resetRerankHealthForTests();
  resetPrometheusMetricsForTests();
  const candidates = [{ id: '1', kind: 'concept', title: 'A', snippet: 'aa' }];
  let calls = 0;
  setRerankGatewayForTests({
    chat: async () => {
      calls += 1;
      throw new Error('rerank unavailable');
    },
    parseJSON: <T>() => ({ scores: [] }) as T,
  });

  try {
    for (let i = 0; i < 10; i += 1) {
      const r = await llmRerank({ query: 'x', candidates });
      assert.equal(r.used, 'fallback');
    }

    const cooled = await llmRerank({ query: 'x', candidates });
    assert.equal(cooled.used, 'fallback');
    assert.equal(calls, 10);

    const body = renderPrometheusMetrics();
    assert.match(body, /compound_rag_rerank_total\{outcome="fallback"\} 10/);
    assert.match(body, /compound_rag_rerank_total\{outcome="cooldown"\} 1/);
    assert.match(body, /compound_rag_rerank_failure_rate 1/);
  } finally {
    setRerankGatewayForTests(null);
    resetRerankHealthForTests();
    resetPrometheusMetricsForTests();
  }
});
