import test from 'node:test';
import assert from 'node:assert/strict';

import { checkFaithfulness } from './faithfulness';

test('checkFaithfulness returns 1 when no citations claimed', () => {
  const r = checkFaithfulness({ answer: '一些没引用的回答', citedConcepts: [] });
  assert.equal(r.score, 1);
  assert.deepEqual(r.unsupported, []);
});

test('checkFaithfulness flags citation with zero token overlap', () => {
  const r = checkFaithfulness({
    answer: '这是一个完全无关的句子 [C1]',
    citedConcepts: [
      {
        id: 'c-1',
        title: '量子力学基础',
        summary: '波函数与不确定性原理',
        body: '量子力学描述微观粒子的行为，主要数学工具是希尔伯特空间的矢量。',
      },
    ],
  });
  assert.equal(r.unsupported.length, 1);
});

test('checkFaithfulness passes when claim shares tokens with cited body', () => {
  const r = checkFaithfulness({
    answer: '用户体验设计需要关注认知心理学的基础原理 [C1]',
    citedConcepts: [
      {
        id: 'c-1',
        title: '用户体验设计',
        summary: '关于用户体验和认知心理学的关系',
        body: '用户体验设计与认知心理学密切相关，需要关注用户的认知负荷。',
      },
    ],
  });
  assert.equal(r.unsupported.length, 0);
  assert.ok(r.score >= 0.99);
});
