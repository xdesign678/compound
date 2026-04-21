import test from 'node:test';
import assert from 'node:assert/strict';

import { pickExistingConceptsForPrompt } from './ingest-core';

test('caps existing concepts without throwing and keeps more relevant entries first', () => {
  const existing = Array.from({ length: 520 }, (_, index) => ({
    id: `c-${index}`,
    title: index === 519 ? '神经可塑性' : `概念 ${index}`,
    summary: index === 519 ? '和大脑学习强相关' : `普通概念 ${index}`,
  }));

  const picked = pickExistingConceptsForPrompt({
    sourceTitle: '神经可塑性笔记',
    sourceRawContent: '这篇文章讨论大脑学习、突触变化和神经可塑性。',
    existingConcepts: existing,
  });

  assert.equal(picked.length, 200);
  assert.equal(picked[0]?.id, 'c-519');
});
