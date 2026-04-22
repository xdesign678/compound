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

test('replaceSourceIdInConcepts 会把旧 source 引用替换成新 source', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-server-db-'));
  const previousDataDir = process.env.DATA_DIR;

  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('./server-db');

  const now = Date.now();
  repo.upsertConcept({
    id: 'c-1',
    title: '概念一',
    summary: '概念一摘要',
    body: '概念一正文',
    sources: ['s-old', 's-other'],
    related: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    categories: [],
    categoryKeys: [],
  });

  const touchedAt = now + 1000;
  const changed = repo.replaceSourceIdInConcepts('s-old', 's-new', touchedAt);
  const concept = repo.getConcept('c-1');

  assert.equal(changed, 1);
  assert.deepEqual(concept?.sources, ['s-new', 's-other']);
  assert.equal(concept?.updatedAt, touchedAt);

  t.after(() => {
    closeServerDbGlobal();
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });
});

test('rebuildAllIndexes 会从现有资料回填 chunk 和 evidence', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-wiki-db-'));
  const previousDataDir = process.env.DATA_DIR;

  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');

  const now = Date.now();
  repo.insertSource({
    id: 's-1',
    title: 'Alpha Notes',
    type: 'file',
    rawContent: `# Alpha

Alpha theory explains the core idea.

## Example

Alpha example shows how the idea works in practice.`,
    ingestedAt: now,
  });
  repo.upsertConcept({
    id: 'c-1',
    title: 'Alpha',
    summary: 'Alpha theory explains the core idea.',
    body: 'Alpha theory explains the core idea and includes an example section.',
    sources: ['s-1'],
    related: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    categories: [],
    categoryKeys: [],
  });

  const result = wikiRepo.rebuildAllIndexes();
  const context = wikiRepo.searchWikiContext('Alpha example', { conceptLimit: 5, chunkLimit: 5 });
  const metrics = wikiRepo.getMetrics();

  assert.equal(result.sources, 1);
  assert.equal(result.concepts, 1);
  assert.ok(result.chunks >= 1);
  assert.ok(result.evidence >= 1);
  assert.equal(context.concepts[0]?.id, 'c-1');
  assert.ok(context.chunks.length >= 1);
  assert.ok(context.evidence.some((item) => item.conceptId === 'c-1'));
  assert.ok(Number(metrics.sourceChunks) >= 1);
  assert.ok(Number(metrics.conceptEvidence) >= 1);

  t.after(() => {
    closeServerDbGlobal();
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });
});
