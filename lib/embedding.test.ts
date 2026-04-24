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

test('embedding 默认不复用聊天模型 key，而是走本地 fallback', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-embedding-'));
  const previousEnv = new Map<string, string | undefined>();
  const envKeys = [
    'DATA_DIR',
    'LLM_API_KEY',
    'COMPOUND_EMBEDDING_PROVIDER',
    'COMPOUND_EMBEDDING_API_KEY',
    'COMPOUND_EMBEDDING_API_URL',
  ];

  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  process.env.DATA_DIR = tempDir;
  process.env.LLM_API_KEY = 'chat-only-key';
  delete process.env.COMPOUND_EMBEDDING_PROVIDER;
  delete process.env.COMPOUND_EMBEDDING_API_KEY;
  delete process.env.COMPOUND_EMBEDDING_API_URL;
  closeServerDbGlobal();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('remote embedding should not be called');
  }) as typeof fetch;

  const { repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { embedSourceChunks, getEmbeddingMetrics } = await import('./embedding');

  const now = Date.now();
  repo.insertSource({
    id: 's-embedding',
    title: 'Embedding Note',
    type: 'file',
    rawContent: '# Embedding\n\nLocal vectors should be enough for development search.',
    ingestedAt: now,
  });
  wikiRepo.indexSource(repo.getSource('s-embedding')!);

  const result = await embedSourceChunks('s-embedding');
  const metrics = getEmbeddingMetrics();

  assert.equal(result.provider, 'local');
  assert.match(result.model, /^local-hash-/);
  assert.ok(result.embedded > 0);
  assert.equal(metrics.embeddingProvider, 'local');

  t.after(() => {
    globalThis.fetch = originalFetch;
    closeServerDbGlobal();
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  });
});
