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

test('remote embedding batches unique chunk texts and reuses duplicate vectors', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-embedding-remote-'));
  const previousEnv = new Map<string, string | undefined>();
  const envKeys = [
    'DATA_DIR',
    'LLM_API_KEY',
    'COMPOUND_EMBEDDING_PROVIDER',
    'COMPOUND_EMBEDDING_API_KEY',
    'COMPOUND_EMBEDDING_API_URL',
    'COMPOUND_EMBEDDING_BATCH_SIZE',
    'COMPOUND_SKIP_DNS_GUARD',
  ];

  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  process.env.DATA_DIR = tempDir;
  process.env.COMPOUND_EMBEDDING_PROVIDER = 'remote';
  process.env.COMPOUND_EMBEDDING_API_KEY = 'embedding-key';
  process.env.COMPOUND_EMBEDDING_API_URL = 'https://example.com/v1/embeddings';
  process.env.COMPOUND_EMBEDDING_BATCH_SIZE = '200';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  delete process.env.LLM_API_KEY;
  closeServerDbGlobal();

  const requestedInputs: string[][] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as { input?: string[] };
    const input = body.input || [];
    requestedInputs.push(input);
    return new Response(
      JSON.stringify({
        data: input.map((text, index) => ({
          embedding: [1, index + 1, text.length],
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  const { getServerDb } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { embedSourceChunks } = await import('./embedding');
  wikiRepo.ensureSchema();

  const now = Date.now();
  const insert = getServerDb().prepare(`
    INSERT INTO source_chunks
      (id, source_id, chunk_index, heading, heading_path, content, token_count, content_hash, created_at, updated_at, contextual_prefix)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < 100; i += 1) {
    const contentIndex = i === 99 ? 0 : i;
    insert.run(
      `chunk-${i}`,
      's-remote',
      i,
      'Remote Heading',
      JSON.stringify(['Remote Heading']),
      `remote embedding text ${contentIndex}`,
      4,
      `hash-${contentIndex}`,
      now,
      now,
      null,
    );
  }

  const result = await embedSourceChunks('s-remote');
  const stored = getServerDb()
    .prepare(`SELECT COUNT(*) AS count FROM chunk_embeddings WHERE source_id = ?`)
    .get('s-remote') as { count: number };

  assert.equal(result.provider, 'remote');
  assert.equal(result.embedded, 100);
  assert.equal(stored.count, 100);
  assert.equal(requestedInputs.length, 1);
  assert.equal(requestedInputs[0].length, 99);
  assert.equal(new Set(requestedInputs[0]).size, 99);

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

test('remote embedding rejects metadata service URLs before sending credentials', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-embedding-ssrf-'));
  const previousEnv = new Map<string, string | undefined>();
  const envKeys = [
    'DATA_DIR',
    'COMPOUND_EMBEDDING_PROVIDER',
    'COMPOUND_EMBEDDING_API_KEY',
    'COMPOUND_EMBEDDING_API_URL',
    'COMPOUND_SKIP_DNS_GUARD',
  ];

  for (const key of envKeys) previousEnv.set(key, process.env[key]);
  process.env.DATA_DIR = tempDir;
  process.env.COMPOUND_EMBEDDING_PROVIDER = 'remote';
  process.env.COMPOUND_EMBEDDING_API_KEY = 'embedding-key';
  process.env.COMPOUND_EMBEDDING_API_URL = 'https://169.254.169.254/latest/meta-data';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  closeServerDbGlobal();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('metadata endpoint must not be called');
  }) as typeof fetch;

  const { repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { embedSourceChunks } = await import('./embedding');

  const now = Date.now();
  repo.insertSource({
    id: 's-ssrf',
    title: 'SSRF',
    type: 'file',
    rawContent: '# SSRF\n\nRemote embedding URL should be validated.',
    ingestedAt: now,
  });
  wikiRepo.indexSource(repo.getSource('s-ssrf')!);

  await assert.rejects(() => embedSourceChunks('s-ssrf'), /public HTTPS endpoint|blocked network/);

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
