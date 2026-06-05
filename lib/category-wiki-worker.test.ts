import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function computeConceptIdsHash(concepts: Array<{ id: string; updatedAt: number }>): string {
  const payload = concepts
    .map((c) => `${c.id}|${c.updatedAt}`)
    .sort()
    .join('\n');
  return createHash('sha1').update(payload).digest('hex').slice(0, 20);
}

describe('computeConceptIdsHash', () => {
  it('returns consistent hash for same input', () => {
    const concepts = [
      { id: 'c-1', updatedAt: 1000 },
      { id: 'c-2', updatedAt: 2000 },
    ];
    const hash1 = computeConceptIdsHash(concepts);
    const hash2 = computeConceptIdsHash(concepts);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 20);
  });

  it('changes hash when concept ids differ', () => {
    const a = [{ id: 'c-1', updatedAt: 1000 }];
    const b = [{ id: 'c-2', updatedAt: 1000 }];
    assert.notEqual(computeConceptIdsHash(a), computeConceptIdsHash(b));
  });

  it('changes hash when updatedAt differs', () => {
    const a = [{ id: 'c-1', updatedAt: 1000 }];
    const b = [{ id: 'c-1', updatedAt: 2000 }];
    assert.notEqual(computeConceptIdsHash(a), computeConceptIdsHash(b));
  });

  it('is order-independent', () => {
    const a = [
      { id: 'c-1', updatedAt: 1000 },
      { id: 'c-2', updatedAt: 2000 },
    ];
    const b = [
      { id: 'c-2', updatedAt: 2000 },
      { id: 'c-1', updatedAt: 1000 },
    ];
    assert.equal(computeConceptIdsHash(a), computeConceptIdsHash(b));
  });

  it('handles empty array', () => {
    const hash = computeConceptIdsHash([]);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 20);
  });
});

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-category-wiki-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  delete (globalThis as Record<string, unknown>).__compoundCategoryWikiWorkers;
  delete (globalThis as Record<string, unknown>).__compoundCategoryWikiRunConfigs;
  return {
    cleanup() {
      closeServerDbGlobal();
      delete (globalThis as Record<string, unknown>).__compoundCategoryWikiWorkers;
      delete (globalThis as Record<string, unknown>).__compoundCategoryWikiRunConfigs;
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('auto queue creates category wiki runs for every discovered secondary category', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const { autoQueueCategoryWikis, listCategoryWikiRuns } = await import('./category-wiki-worker');
  const now = Date.now();

  repo.upsertConcept({
    id: 'c-social-1',
    title: '社会比较反馈',
    summary: '通过同伴对比影响行为。',
    body: '社会比较反馈正文',
    sources: [],
    related: [],
    categories: [{ primary: '认知心理学', secondary: '社会认知' }],
    categoryKeys: ['认知心理学', '认知心理学/社会认知'],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  repo.upsertConcept({
    id: 'c-design-1',
    title: '默认效应',
    summary: '默认选项改变选择。',
    body: '默认效应正文',
    sources: [],
    related: [],
    categories: [{ primary: '用户体验', secondary: '行为设计' }],
    categoryKeys: ['用户体验', '用户体验/行为设计'],
    createdAt: now + 1,
    updatedAt: now + 1,
    version: 1,
  });
  repo.upsertConcept({
    id: 'c-primary-only',
    title: '心理学',
    summary: '一级分类不应生成二级主题 Wiki。',
    body: '一级分类正文',
    sources: [],
    related: [],
    categories: [{ primary: '心理学' }],
    categoryKeys: ['心理学'],
    createdAt: now + 2,
    updatedAt: now + 2,
    version: 1,
  });

  const result = autoQueueCategoryWikis({ startWorkers: false });

  assert.equal(result.discovered, 2);
  assert.equal(result.queued, 2);
  assert.equal(listCategoryWikiRuns('认知心理学', '社会认知', 5).length, 1);
  assert.equal(listCategoryWikiRuns('用户体验', '行为设计', 5).length, 1);
  assert.equal(listCategoryWikiRuns('心理学', '', 5).length, 0);
});

test('auto queue skips fresh category wiki content and requeues stale content', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const { autoQueueCategoryWikis, computeConceptIdsHash, listCategoryWikiRuns } =
    await import('./category-wiki-worker');
  const now = Date.now();

  repo.upsertConcept({
    id: 'c-ready',
    title: '认知失调',
    summary: '信念与行为不一致时的心理紧张。',
    body: '认知失调正文',
    sources: [],
    related: [],
    categories: [{ primary: '认知心理学', secondary: '社会认知' }],
    categoryKeys: ['认知心理学', '认知心理学/社会认知'],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  repo.upsertCategoryWiki({
    id: 'cw-ready',
    primaryCategory: '认知心理学',
    secondaryCategory: '社会认知',
    bodyMd: '# 社会认知',
    tocJson: '[]',
    conceptIds: ['c-ready'],
    conceptIdsHash: computeConceptIdsHash([{ id: 'c-ready', updatedAt: now }]),
    generatedAt: now,
  });

  const first = autoQueueCategoryWikis({ startWorkers: false });
  assert.equal(first.discovered, 1);
  assert.equal(first.queued, 0);
  assert.equal(first.skippedFresh, 1);

  assert.equal(repo.markCategoryWikisStale([{ primary: '认知心理学', secondary: '社会认知' }]), 1);

  const second = autoQueueCategoryWikis({ startWorkers: false });
  assert.equal(second.queued, 1);
  assert.equal(listCategoryWikiRuns('认知心理学', '社会认知', 5).length, 1);

  const third = autoQueueCategoryWikis({ startWorkers: false });
  assert.equal(third.queued, 0);
  assert.equal(third.skippedActive, 1);
});
