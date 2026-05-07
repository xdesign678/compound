import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRecapGestureAxis } from './recap-gesture-lock';

test('recap gesture waits for the first 8 frames before locking', () => {
  assert.equal(resolveRecapGestureAxis({ dx: 120, dy: 20, frameCount: 7 }), null);
});

test('recap gesture locks horizontal only when dx clearly dominates dy', () => {
  assert.equal(resolveRecapGestureAxis({ dx: 120, dy: 40, frameCount: 8 }), 'horizontal');
});

test('recap gesture treats diagonal movement as vertical to avoid accidental card swipes', () => {
  assert.equal(resolveRecapGestureAxis({ dx: 60, dy: 55, frameCount: 8 }), 'vertical');
});
