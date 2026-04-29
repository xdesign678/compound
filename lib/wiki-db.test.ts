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

test('replaceSourceIdInConcepts 能处理需要 JSON 和 LIKE 转义的 source id', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-server-db-'));
  const previousDataDir = process.env.DATA_DIR;

  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('./server-db');

  const now = Date.now();
  repo.upsertConcept({
    id: 'c-escaped-source',
    title: '特殊资料引用',
    summary: '特殊资料引用摘要',
    body: '特殊资料引用正文',
    sources: ['s-"old_%', 's-other'],
    related: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    categories: [],
    categoryKeys: [],
  });

  const touchedAt = now + 1000;
  const changed = repo.replaceSourceIdInConcepts('s-"old_%', 's-new', touchedAt);
  const concept = repo.getConcept('c-escaped-source');

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

test('replaceRelatedId 能处理需要 JSON 和 LIKE 转义的 related id', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-server-db-'));
  const previousDataDir = process.env.DATA_DIR;

  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('./server-db');

  const now = Date.now();
  repo.upsertConcept({
    id: 'c-escaped-related',
    title: '特殊关联',
    summary: '特殊关联摘要',
    body: '特殊关联正文',
    sources: [],
    related: ['c-"old_%', 'c-other'],
    createdAt: now,
    updatedAt: now,
    version: 1,
    categories: [],
    categoryKeys: [],
  });

  const touchedAt = now + 1000;
  const changed = repo.replaceRelatedId('c-"old_%', 'c-new', touchedAt);
  const concept = repo.getConcept('c-escaped-related');

  assert.equal(changed, 1);
  assert.deepEqual(concept?.related, ['c-new', 'c-other']);
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

test('findConceptCandidates 会优先命中嵌在中文问题里的概念标题', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-server-db-'));
  const previousDataDir = process.env.DATA_DIR;

  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('./server-db');

  const now = Date.now();
  repo.upsertConcept({
    id: 'c-embodied-cognition',
    title: '具身认知',
    summary: '身体的感觉运动系统不是认知的旁观者，而是积极参与者。',
    body: '具身认知强调身体、感知运动系统和环境共同塑造认知。',
    sources: [],
    related: [],
    createdAt: now - 10_000,
    updatedAt: now - 10_000,
    version: 1,
    categories: [],
    categoryKeys: [],
  });

  for (let i = 0; i < 5; i++) {
    repo.upsertConcept({
      id: `c-unrelated-${i}`,
      title: `无关概念 ${i}`,
      summary: '这个概念只是用来占据最近更新候选。',
      body: '无关正文。',
      sources: [],
      related: [],
      createdAt: now + i,
      updatedAt: now + i,
      version: 1,
      categories: [],
      categoryKeys: [],
    });
  }

  const candidates = repo.findConceptCandidates('具身认知相关解释', 3);

  assert.equal(candidates[0]?.id, 'c-embodied-cognition');

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

test('getConceptVersions 按版本倒序返回 AI 编辑记录', async (t) => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-wiki-db-'));
  const previousDataDir = process.env.DATA_DIR;

  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { wikiRepo } = await import('./wiki-db');

  wikiRepo.recordConceptVersion({
    conceptId: 'c-history',
    version: 1,
    nextBody: '第一版',
    sourceIds: ['s-1'],
    changeSummary: '首次创建。',
  });
  wikiRepo.recordConceptVersion({
    conceptId: 'c-history',
    version: 2,
    previousBody: '第一版',
    nextBody: '第二版',
    sourceIds: ['s-2'],
    changeSummary: '补充第二版内容。',
  });

  const versions = wikiRepo.getConceptVersions('c-history');

  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 2);
  assert.equal(versions[0].changeSummary, '补充第二版内容。');
  assert.deepEqual(versions[0].sourceIds, ['s-2']);
  assert.equal(versions[1].version, 1);

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
