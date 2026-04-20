import test from 'node:test';
import assert from 'node:assert/strict';

import { getPollFailurePlan } from './github-sync-poll.ts';

test('retries transient 502 poll failures before marking sync as failed', () => {
  const plan = getPollFailurePlan({
    status: 502,
    message: '状态查询失败 (502): Bad Gateway',
    consecutiveFailures: 0,
  });

  assert.equal(plan.shouldRetry, true);
  assert.equal(plan.nextFailureCount, 1);
  assert.match(plan.userMessage, /正在重试/);
});

test('stops retrying after reaching the retry limit', () => {
  const plan = getPollFailurePlan({
    status: 502,
    message: '状态查询失败 (502): Bad Gateway',
    consecutiveFailures: 2,
  });

  assert.equal(plan.shouldRetry, false);
  assert.equal(plan.nextFailureCount, 3);
});

test('does not retry non-transient poll errors', () => {
  const plan = getPollFailurePlan({
    status: 404,
    message: '状态查询失败 (404): job not found',
    consecutiveFailures: 0,
  });

  assert.equal(plan.shouldRetry, false);
  assert.equal(plan.nextFailureCount, 1);
});
