import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-ingest-ops-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test(
  'same operationId and payload returns the compact hydrated ingest result',
  { concurrency: false },
  async () => {
    const env = setupTempDb();
    const { repo } = await import('./server-db');
    const {
      beginIngestOperation,
      completeIngestOperation,
      hashIngestPayload,
      readIngestOperationRow,
    } = await import('./ingest-operations');
    try {
      const identity = repo.getDatasetIdentity();
      assert.equal(typeof identity.datasetId, 'string');
      assert.equal(identity.generation, 1);

      const payloadHash = hashIngestPayload({
        title: '笔记',
        type: 'text',
        rawContent: '正文',
        model: 'wiki-model',
        apiUrl: '',
        keyFingerprint: 'abc',
      });
      const first = beginIngestOperation('op-replay-token01', payloadHash);
      assert.equal(first.kind, 'new');
      if (first.kind !== 'new') throw new Error('expected new');
      completeIngestOperation(
        'op-replay-token01',
        {
          sourceId: 's-1',
          newConceptIds: ['c-1'],
          updatedConceptIds: [],
          activityId: 'a-1',
          extra: true,
        } as {
          sourceId: string;
          newConceptIds: string[];
          updatedConceptIds: string[];
          activityId: string;
        },
        first.attemptToken,
      );
      const stored = readIngestOperationRow('op-replay-token01');
      assert.ok(stored?.result_json);
      assert.equal(stored.result_json?.includes('正文'), false);
      assert.equal(stored.result_json?.includes('extra'), false);
      const replay = beginIngestOperation('op-replay-token01', payloadHash);
      assert.equal(replay.kind, 'replay');
      if (replay.kind !== 'replay') throw new Error('expected replay');
      assert.equal(replay.result.sourceId, 's-1');
      assert.deepEqual(replay.result.newConceptIds, ['c-1']);
      assert.equal('rawContent' in (replay.result.source ?? {}), false);
    } finally {
      env.cleanup();
    }
  },
);

test(
  'same operationId with a different payload is a 409 conflict',
  { concurrency: false },
  async () => {
    const env = setupTempDb();
    await import('./server-db');
    const { beginIngestOperation, hashIngestPayload, IngestOperationHttpError } =
      await import('./ingest-operations');
    try {
      const hashA = hashIngestPayload({ title: 'A', type: 'text', rawContent: 'a' });
      const hashB = hashIngestPayload({ title: 'B', type: 'text', rawContent: 'b' });
      beginIngestOperation('op-conflict-tok01', hashA);
      assert.throws(
        () => beginIngestOperation('op-conflict-tok01', hashB),
        (error: unknown) =>
          error instanceof IngestOperationHttpError && error.code === 'ingest_operation_conflict',
      );
    } finally {
      env.cleanup();
    }
  },
);

test('payload hash includes non-secret execution context', { concurrency: false }, async () => {
  const { hashIngestPayload } = await import('./ingest-operations');
  const base = { title: 'A', type: 'text', rawContent: 'a' };
  const withModel = hashIngestPayload({ ...base, model: 'm1' });
  const withOtherModel = hashIngestPayload({ ...base, model: 'm2' });
  const withKey = hashIngestPayload({ ...base, keyFingerprint: 'fp-1' });
  assert.notEqual(withModel, withOtherModel);
  assert.notEqual(withModel, withKey);
});

test('illegal operationId is a 400', { concurrency: false }, async () => {
  const env = setupTempDb();
  await import('./server-db');
  const { beginIngestOperation, IngestOperationHttpError } = await import('./ingest-operations');
  try {
    assert.throws(
      () => beginIngestOperation('not-valid', 'hash'),
      (error: unknown) =>
        error instanceof IngestOperationHttpError &&
        error.status === 400 &&
        error.code === 'invalid_operation_id',
    );
    assert.throws(
      () => beginIngestOperation('op-short', 'hash'),
      (error: unknown) => error instanceof IngestOperationHttpError && error.status === 400,
    );
  } finally {
    env.cleanup();
  }
});

test(
  'expired processing operations can be reclaimed without duplicating a success row',
  { concurrency: false },
  async () => {
    const env = setupTempDb();
    await import('./server-db');
    const {
      INGEST_OPERATION_LEASE_MS,
      beginIngestOperation,
      completeIngestOperation,
      hashIngestPayload,
    } = await import('./ingest-operations');
    try {
      const payloadHash = hashIngestPayload({ title: 'C', type: 'text', rawContent: 'c' });
      const started = Date.now() - INGEST_OPERATION_LEASE_MS - 1000;
      const first = beginIngestOperation('op-reclaim-tokn01', payloadHash, started);
      assert.equal(first.kind, 'new');
      const reclaimed = beginIngestOperation('op-reclaim-tokn01', payloadHash, Date.now());
      assert.equal(reclaimed.kind, 'new');
      if (reclaimed.kind !== 'new') throw new Error('expected new');
      completeIngestOperation(
        'op-reclaim-tokn01',
        { sourceId: 's-recovered' },
        reclaimed.attemptToken,
      );
      const replay = beginIngestOperation('op-reclaim-tokn01', payloadHash);
      assert.equal(replay.kind, 'replay');
      if (replay.kind !== 'replay') throw new Error('expected replay');
      assert.equal(replay.result.sourceId, 's-recovered');
    } finally {
      env.cleanup();
    }
  },
);

test(
  'stale attempt fail/complete cannot overwrite a newer lease',
  { concurrency: false },
  async () => {
    const env = setupTempDb();
    await import('./server-db');
    const {
      INGEST_OPERATION_LEASE_MS,
      beginIngestOperation,
      completeIngestOperation,
      failIngestOperation,
      hashIngestPayload,
      readIngestOperationRow,
      IngestOperationHttpError,
    } = await import('./ingest-operations');
    try {
      const payloadHash = hashIngestPayload({ title: 'Fence', type: 'text', rawContent: 'x' });
      const started = Date.now() - INGEST_OPERATION_LEASE_MS - 1000;
      const attemptA = beginIngestOperation('op-fence-token001', payloadHash, started);
      assert.equal(attemptA.kind, 'new');
      if (attemptA.kind !== 'new') throw new Error('expected new');
      const attemptB = beginIngestOperation('op-fence-token001', payloadHash, Date.now());
      assert.equal(attemptB.kind, 'new');
      if (attemptB.kind !== 'new') throw new Error('expected new');
      assert.notEqual(attemptA.attemptToken, attemptB.attemptToken);

      failIngestOperation('op-fence-token001', new Error('A timed out'), attemptA.attemptToken);
      let row = readIngestOperationRow('op-fence-token001');
      assert.equal(row?.status, 'processing');
      assert.equal(row?.attempt_token, attemptB.attemptToken);

      assert.throws(
        () =>
          completeIngestOperation(
            'op-fence-token001',
            { sourceId: 's-from-a' },
            attemptA.attemptToken,
          ),
        (error: unknown) =>
          error instanceof IngestOperationHttpError && error.code === 'ingest_operation_lease_lost',
      );
      row = readIngestOperationRow('op-fence-token001');
      assert.equal(row?.status, 'processing');
      assert.equal(row?.source_id, null);

      completeIngestOperation('op-fence-token001', { sourceId: 's-from-b' }, attemptB.attemptToken);
      row = readIngestOperationRow('op-fence-token001');
      assert.equal(row?.status, 'succeeded');
      assert.equal(row?.source_id, 's-from-b');
      assert.equal(row?.result_json?.includes('s-from-a'), false);
    } finally {
      env.cleanup();
    }
  },
);
