import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUnreadinessReason,
  isProcessReady,
  markProcessUnready,
  resetProcessReadinessForTests,
} from './process-readiness';

test('fatal unreadiness flips the ready flag', () => {
  resetProcessReadinessForTests();
  assert.equal(isProcessReady(), true);
  markProcessUnready('uncaughtException');
  assert.equal(isProcessReady(), false);
  assert.equal(getUnreadinessReason(), 'uncaughtException');
  resetProcessReadinessForTests();
  assert.equal(isProcessReady(), true);
  assert.equal(getUnreadinessReason(), null);
});

test('process readiness state is shared via globalThis across chunks', () => {
  resetProcessReadinessForTests();
  markProcessUnready('drain');
  const holder = (
    globalThis as unknown as Record<string, { ready: boolean; reason: string | null }>
  ).__compound_process_readiness__;
  assert.equal(holder.ready, false);
  assert.equal(holder.reason, 'drain');
  assert.equal(isProcessReady(), false);
  resetProcessReadinessForTests();
});
