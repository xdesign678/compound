import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WIKI_REMOTE_SEARCH_DEBOUNCE_MS,
  createStaleRequestGuard,
  scheduleDebouncedCallback,
} from './wiki-search-schedule';

test('wiki remote search debounce is 200-300ms', () => {
  assert.ok(WIKI_REMOTE_SEARCH_DEBOUNCE_MS >= 200);
  assert.ok(WIKI_REMOTE_SEARCH_DEBOUNCE_MS <= 300);
});

test('rapid input only fires the latest search after previous timers are cancelled', () => {
  const calls: string[] = [];
  const pending: { fn: () => void; ms: number }[] = [];
  const fakeSetTimeout = (fn: () => void, ms: number) => {
    pending.splice(0, pending.length, { fn, ms });
    return 1 as unknown as ReturnType<typeof setTimeout>;
  };

  for (const query of ['a', 'ab', 'abc', 'abcd']) {
    scheduleDebouncedCallback(
      WIKI_REMOTE_SEARCH_DEBOUNCE_MS,
      () => {
        calls.push(query);
      },
      fakeSetTimeout,
    );
  }
  assert.equal(pending.length, 1);
  assert.equal(pending[0].ms, WIKI_REMOTE_SEARCH_DEBOUNCE_MS);
  pending[0].fn();
  assert.deepEqual(calls, ['abcd']);
});

test('stale response guard ignores superseded generations', () => {
  const guard = createStaleRequestGuard();
  const first = guard.next();
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});
