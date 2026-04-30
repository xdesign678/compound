import test from 'node:test';
import assert from 'node:assert/strict';

import { rewriteQuery } from './query-rewrite';

test('rewriteQuery returns empty for empty input', async () => {
  const r = await rewriteQuery({ question: '' });
  assert.equal(r.rewritten, '');
  assert.equal(r.used, 'pass-through');
});

test('rewriteQuery skips LLM when no history', async () => {
  const r = await rewriteQuery({ question: '什么是 RAG' });
  assert.equal(r.rewritten, '什么是 RAG');
  assert.equal(r.used, 'pass-through');
});

test('rewriteQuery skips LLM when question has no pronouns', async () => {
  const r = await rewriteQuery({
    question: '什么是 RAG',
    history: [{ role: 'user', text: '聊聊知识管理' }],
  });
  assert.equal(r.used, 'pass-through');
});

test('rewriteQuery passes through when env disables it', async () => {
  process.env.COMPOUND_QUERY_REWRITE = 'off';
  try {
    const r = await rewriteQuery({
      question: '它和 RAG 比怎么样',
      history: [
        { role: 'user', text: '什么是 GraphRAG' },
        { role: 'ai', text: '...' },
      ],
    });
    assert.equal(r.rewritten, '它和 RAG 比怎么样');
    assert.equal(r.used, 'pass-through');
  } finally {
    delete process.env.COMPOUND_QUERY_REWRITE;
  }
});
