import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCategories, normalizeCategoryKeys } from './category-normalization';

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

  assert.deepEqual(normalized, [
    { primary: '脑科学', secondary: '睡眠与节律' },
    { primary: '脑科学' },
  ]);
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
