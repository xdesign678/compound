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

test('counts and pages sources and concepts at SQL layer', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-server-db-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('./server-db');
  const now = Date.now();
  for (let i = 0; i < 6; i += 1) {
    repo.insertSource({
      id: `s-${i}`,
      title: `Source ${i}`,
      type: 'file',
      rawContent: `content ${i}`,
      ingestedAt: now + i,
    });
    repo.upsertConcept({
      id: `c-${i}`,
      title: `Concept ${i}`,
      summary: `summary ${i}`,
      body: `body ${i}`,
      sources: [`s-${i % 2}`],
      related: [],
      categories: [],
      categoryKeys: [],
      createdAt: now + i,
      updatedAt: now + i,
      version: 1,
    });
  }

  assert.equal(repo.countSources(), 6);
  assert.equal(repo.countConcepts(), 6);
  assert.deepEqual(
    repo.listSources({ summariesOnly: true, limit: 2, offset: 2 }).map((source) => source.id),
    ['s-3', 's-2'],
  );
  assert.deepEqual(
    repo.listConceptsBySourceId('s-1', { limit: 2 }).map((concept) => concept.id),
    ['c-5', 'c-3'],
  );

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
