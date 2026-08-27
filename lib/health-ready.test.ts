import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isProcessReady,
  markProcessUnready,
  resetProcessReadinessForTests,
} from './process-readiness';

test('fatal unreadiness flips the ready flag', () => {
  resetProcessReadinessForTests();
  assert.equal(isProcessReady(), true);
  markProcessUnready('uncaughtException');
  assert.equal(isProcessReady(), false);
  resetProcessReadinessForTests();
});
