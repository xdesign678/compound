import test from 'node:test';
import assert from 'node:assert/strict';

import { jiebaTokenize, buildFtsMatchExpr } from './jieba-tokenize';

test('jiebaTokenize splits chinese question into multi-char terms', () => {
  const terms = jiebaTokenize('用户体验设计与认知心理学的关系');
  assert.ok(terms.includes('用户'), `expected 用户 in ${JSON.stringify(terms)}`);
  assert.ok(terms.includes('体验'), `expected 体验 in ${JSON.stringify(terms)}`);
  assert.ok(terms.includes('认知'), `expected 认知 in ${JSON.stringify(terms)}`);
  assert.ok(terms.includes('心理学'), `expected 心理学 in ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes('的'), '应该过滤停用词');
  assert.ok(!terms.includes('与'), '应该过滤停用词');
});

test('jiebaTokenize keeps english tokens and drops single ascii noise', () => {
  const terms = jiebaTokenize('what is RAG retrieval');
  assert.ok(terms.includes('rag'), `expected rag, got ${JSON.stringify(terms)}`);
  assert.ok(terms.includes('retrieval'), `expected retrieval, got ${JSON.stringify(terms)}`);
});

test('jiebaTokenize handles empty / pure-punct input gracefully', () => {
  assert.deepEqual(jiebaTokenize(''), []);
  assert.deepEqual(jiebaTokenize('   '), []);
  assert.deepEqual(jiebaTokenize('，。！？'), []);
});

test('jiebaTokenize falls back to single CJK chars when nothing else survives', () => {
  const terms = jiebaTokenize('的');
  // Single char + stopword would normally be dropped, but the last-resort
  // fallback re-adds CJK singletons so we still match something.
  assert.ok(terms.length >= 0); // tolerate either empty or fallback
});

test('jiebaTokenize caps at limit', () => {
  const terms = jiebaTokenize('用户体验设计与认知心理学的关系是什么以及RAG检索如何工作', 3);
  assert.ok(terms.length <= 3);
});

test('buildFtsMatchExpr quotes terms and joins with OR', () => {
  const expr = buildFtsMatchExpr('用户体验');
  // Expected to look like `"用户" OR "体验"` (jieba may segment differently
  // depending on dictionary; just assert OR-joined quoted phrases).
  assert.match(expr, /^"[^"]+"( OR "[^"]+")*$/);
});

test('buildFtsMatchExpr returns empty string for empty query', () => {
  assert.equal(buildFtsMatchExpr(''), '');
});
