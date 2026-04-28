import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCategories,
  normalizeCategoryKeys,
  normalizeCategoryState,
} from './category-normalization';

test('strictly merges neuroscience aliases into 脑科学', () => {
  const normalized = normalizeCategories([
    { primary: '神经科学' },
    { primary: '脑科学/神经科学' },
    { primary: '脑科学', secondary: '神经科学' },
  ]);

  assert.deepEqual(normalized, [{ primary: '脑科学' }]);
});

test('keeps meaningful secondary labels while removing duplicates and blanks', () => {
  const normalized = normalizeCategories([
    { primary: '脑科学', secondary: '睡眠与节律' },
    { primary: '脑科学', secondary: '睡眠与节律' },
    { primary: '  脑科学  ', secondary: '  ' },
    { primary: '', secondary: '神经科学' },
  ]);

  assert.deepEqual(normalized, [{ primary: '脑科学', secondary: '睡眠与节律' }]);
});

test('normalizes flat category keys before prompt reuse and filtering', () => {
  const normalized = normalizeCategoryKeys([
    '神经科学',
    '脑科学/神经科学',
    '脑科学',
    '脑科学/睡眠与节律',
  ]);

  assert.deepEqual(normalized, ['脑科学', '脑科学/睡眠与节律']);
});

test('promotes overgrown methodology buckets into stable primary categories', () => {
  const normalized = normalizeCategories([
    { primary: '方法论', secondary: '用户体验' },
    { primary: '方法论', secondary: '用户研究' },
    { primary: '方法论', secondary: '认知偏差' },
    { primary: '设计原则' },
  ]);

  assert.deepEqual(normalized, [
    { primary: '用户体验', secondary: '用户研究' },
    { primary: '认知心理学', secondary: '认知偏差' },
    { primary: '用户体验', secondary: '设计原则' },
  ]);
});

test('flattens nested secondary paths and removes parent-only duplicate tags', () => {
  const normalized = normalizeCategoryState({
    categories: [
      { primary: '方法论', secondary: '认知心理学/认知偏差' },
      { primary: '方法论', secondary: '认知偏差' },
      { primary: '方法论' },
      { primary: '脑科学', secondary: '认知科学/工作记忆' },
      { primary: '脑科学', secondary: '方法论/教育认知' },
      { primary: '方法论', secondary: '脑科学/认知科学/记忆机制' },
      { primary: '脑科学' },
    ],
  });

  assert.deepEqual(normalized.categories, [
    { primary: '认知心理学', secondary: '认知偏差' },
    { primary: '脑科学', secondary: '工作记忆' },
    { primary: '脑科学', secondary: '教育认知' },
    { primary: '脑科学', secondary: '记忆机制' },
  ]);
  assert.deepEqual(normalized.categoryKeys, [
    '认知心理学',
    '认知心理学/认知偏差',
    '脑科学',
    '脑科学/工作记忆',
    '脑科学/教育认知',
    '脑科学/记忆机制',
  ]);
});
