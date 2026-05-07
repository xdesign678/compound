import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreCommandMatch } from './utils';

test('scoreCommandMatch prefers exact substring matches', () => {
  const direct = scoreCommandMatch('wiki', '切换到 Wiki');
  const fuzzy = scoreCommandMatch('wiki', '打开设置');

  assert.ok(direct > fuzzy);
});

test('scoreCommandMatch supports sparse character matches for Chinese labels', () => {
  assert.ok(scoreCommandMatch('脑科', '脑科学入门') > 0);
});

test('scoreCommandMatch gives typo-tolerant matches a smaller positive score', () => {
  const exact = scoreCommandMatch('setting', 'settings');
  const typo = scoreCommandMatch('seting', 'settings');

  assert.ok(typo > 0);
  assert.ok(exact > typo);
});
