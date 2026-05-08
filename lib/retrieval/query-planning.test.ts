import test from 'node:test';
import assert from 'node:assert/strict';

import { decideRerank, getRerankCandidateLimit, limitRerankCandidates } from './query-planning';
import type { RerankCandidate } from './llm-rerank';

const candidates: RerankCandidate[] = [
  { id: 'concept:llm-wiki', kind: 'concept', title: 'LLM Wiki 模式', snippet: 'Markdown Wiki' },
  { id: 'concept:rag-gap', kind: 'concept', title: 'RAG 的结构性缺陷', snippet: '每次查询' },
  { id: 'chunk:raw-sources', kind: 'chunk', title: 'Raw Sources', snippet: '不可变原始资料' },
];

test('decideRerank uses fts-only fast path by default', () => {
  const decision = decideRerank({
    candidateCount: 18,
    finalTopK: 8,
    retrievalMode: 'fts-only',
  });
  assert.equal(decision.useLlm, false);
  assert.equal(decision.reason, 'fts-fast-path');
});

test('decideRerank allows remote embedding rerank when candidate set is larger than final topK', () => {
  const decision = decideRerank({
    candidateCount: 18,
    finalTopK: 8,
    retrievalMode: 'remote-emb',
  });
  assert.equal(decision.useLlm, true);
  assert.equal(decision.reason, 'enabled');
});

test('decideRerank skips LLM when candidates already fit final topK', () => {
  const decision = decideRerank({
    candidateCount: 6,
    finalTopK: 8,
    retrievalMode: 'remote-emb',
  });
  assert.equal(decision.useLlm, false);
  assert.equal(decision.reason, 'already-within-final-top-k');
});

test('limitRerankCandidates keeps the highest-ranked FTS candidates first', () => {
  const limited = limitRerankCandidates(candidates, 2);
  assert.deepEqual(
    limited.map((candidate) => candidate.id),
    ['concept:llm-wiki', 'concept:rag-gap'],
  );
});

test('getRerankCandidateLimit reads env override', () => {
  process.env.COMPOUND_RERANK_CANDIDATE_LIMIT = '10';
  try {
    assert.equal(getRerankCandidateLimit(8), 10);
  } finally {
    delete process.env.COMPOUND_RERANK_CANDIDATE_LIMIT;
  }
});
