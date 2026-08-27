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
  'same operationId and payload returns the stored ingest result',
  { concurrency: false },
  async () => {
    const env = setupTempDb();
    const { repo } = await import('./server-db');
    const { beginIngestOperation, completeIngestOperation, hashIngestPayload } =
      await import('./ingest-operations');
    try {
      const identity = repo.getDatasetIdentity();
      assert.equal(typeof identity.datasetId, 'string');
      assert.equal(identity.generation, 1);

      const payloadHash = hashIngestPayload({
        title: '笔记',
        type: 'text',
        rawContent: '正文',
      });
      const first = beginIngestOperation('op-1', payloadHash);
      assert.equal(first.kind, 'new');
      completeIngestOperation('op-1', { sourceId: 's-1', extra: true } as { sourceId: string });
      const replay = beginIngestOperation('op-1', payloadHash);
      assert.equal(replay.kind, 'replay');
      assert.deepEqual(replay.result, { sourceId: 's-1', extra: true });
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
      beginIngestOperation('op-2', hashA);
      assert.throws(
        () => beginIngestOperation('op-2', hashB),
        (error: unknown) =>
          error instanceof IngestOperationHttpError && error.code === 'ingest_operation_conflict',
      );
    } finally {
      env.cleanup();
    }
  },
);

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
      const first = beginIngestOperation('op-3', payloadHash, started);
      assert.equal(first.kind, 'new');
      const reclaimed = beginIngestOperation('op-3', payloadHash, Date.now());
      assert.equal(reclaimed.kind, 'new');
      completeIngestOperation('op-3', { sourceId: 's-recovered' });
      const replay = beginIngestOperation('op-3', payloadHash);
      assert.equal(replay.kind, 'replay');
      assert.deepEqual(replay.result, { sourceId: 's-recovered' });
    } finally {
      env.cleanup();
    }
  },
);
