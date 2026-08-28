import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkDatasetIdentityAnchor,
  datasetIdentityAnchorConfigured,
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

test('dataset identity anchor is explicit when not configured', () => {
  assert.equal(datasetIdentityAnchorConfigured(undefined), false);
  assert.equal(datasetIdentityAnchorConfigured('   '), false);
  assert.equal(checkDatasetIdentityAnchor(undefined, 'dataset-local'), 'not_configured');
  assert.equal(checkDatasetIdentityAnchor('   ', 'dataset-local'), 'not_configured');
});

test('dataset identity anchor verifies an exact match', () => {
  assert.equal(datasetIdentityAnchorConfigured(' dataset-production '), true);
  assert.equal(
    checkDatasetIdentityAnchor(' dataset-production ', 'dataset-production'),
    'verified',
  );
});

test('dataset identity anchor rejects a missing or mismatched dataset', () => {
  assert.throws(
    () => checkDatasetIdentityAnchor('dataset-production', null),
    /dataset identity is missing/,
  );
  assert.throws(
    () => checkDatasetIdentityAnchor('dataset-production', 'dataset-empty-volume'),
    /dataset identity anchor mismatch/,
  );
});
