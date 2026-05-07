import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeRecentCommandItem } from './preferences-slice';

test('mergeRecentCommandItem puts newest item first and deduplicates by kind/id', () => {
  const items = mergeRecentCommandItem(
    [
      { kind: 'concept', id: 'a', title: '旧标题', at: 1 },
      { kind: 'source', id: 's', title: '资料', at: 2 },
    ],
    { kind: 'concept', id: 'a', title: '新标题', at: 3 },
  );

  assert.deepEqual(items[0], { kind: 'concept', id: 'a', title: '新标题', at: 3 });
  assert.equal(items.length, 2);
});

test('mergeRecentCommandItem keeps at most 10 items', () => {
  const current = Array.from({ length: 10 }, (_, index) => ({
    kind: 'concept' as const,
    id: String(index),
    title: `概念 ${index}`,
    at: index,
  }));

  const items = mergeRecentCommandItem(current, {
    kind: 'source',
    id: 'new',
    title: '新资料',
    at: 11,
  });

  assert.equal(items.length, 10);
  assert.equal(items[0].id, 'new');
  assert.equal(
    items.some((item) => item.id === '9'),
    false,
  );
});
