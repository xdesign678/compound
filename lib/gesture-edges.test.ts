import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IOS_SAFARI_SWIPE_BACK_EDGE_WIDTH,
  PULL_TO_REFRESH_EDGE_GUARD_WIDTH,
  SWIPE_BACK_EDGE_WIDTH,
} from './gesture-edges';

test('pull-to-refresh guards the same left edge used by swipe back', () => {
  assert.equal(PULL_TO_REFRESH_EDGE_GUARD_WIDTH, SWIPE_BACK_EDGE_WIDTH);
  assert.ok(IOS_SAFARI_SWIPE_BACK_EDGE_WIDTH < SWIPE_BACK_EDGE_WIDTH);
});
