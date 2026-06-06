import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SourceChunkDraft } from './wiki-chunk';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-source-atomicity-'));
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

function makeDraft(index: number, content: string): SourceChunkDraft {
  return {
    chunkIndex: index,
    heading: `Heading ${index}`,
    headingPath: [`Heading ${index}`],
    content,
    tokenCount: content.length,
    contentHash: `hash-${index}-${content.length}`,
  };
}

async function countChunks(sourceId?: string): Promise<number> {
  const { getServerDb } = await import('./server-db');
  const db = getServerDb();
  if (sourceId) {
    return Number(
      (
        db.prepare(`SELECT COUNT(*) AS c FROM source_chunks WHERE source_id = ?`).get(sourceId) as {
          c: number;
        }
      ).c,
    );
  }
  return Number((db.prepare(`SELECT COUNT(*) AS c FROM source_chunks`).get() as { c: number }).c);
}

async function countEvidence(sourceId: string): Promise<number> {
  const { getServerDb } = await import('./server-db');
  return Number(
    (
      getServerDb()
        .prepare(`SELECT COUNT(*) AS c FROM concept_evidence WHERE source_id = ?`)
        .get(sourceId) as { c: number }
    ).c,
  );
}

test(
  'upsertSourceChunks 在 delete 与 insert 之间抛错时整体回滚（chunk/evidence all-or-nothing）',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { wikiRepo } = await import('./wiki-db');
    const { repo } = await import('./server-db');

    const now = Date.now();
    repo.insertSource({
      id: 's-1',
      title: 'S1',
      type: 'file',
      rawContent: '# S1',
      ingestedAt: now,
    });

    const initial = wikiRepo.upsertSourceChunks(
      's-1',
      [makeDraft(0, 'alpha content'), makeDraft(1, 'beta content')],
      now,
    );
    assert.equal(initial.length, 2);
    wikiRepo.addEvidenceBatch([
      {
        conceptId: 'c-1',
        sourceId: 's-1',
        chunkId: initial[0].id,
        quote: 'q',
        claim: 'claim',
        kind: 'support',
        confidence: 0.5,
      },
    ]);

    assert.equal(await countChunks('s-1'), 2);
    assert.equal(await countEvidence('s-1'), 1);

    const realDelete = wikiRepo.deleteSourceArtifacts.bind(wikiRepo);
    wikiRepo.deleteSourceArtifacts = (id: string) => {
      realDelete(id);
      throw new Error('injected failure between delete and insert');
    };

    let threw = false;
    try {
      wikiRepo.upsertSourceChunks('s-1', [makeDraft(0, 'gamma content')], now + 1);
    } catch {
      threw = true;
    } finally {
      wikiRepo.deleteSourceArtifacts = realDelete;
    }

    assert.ok(threw, 'upsertSourceChunks 应把注入的错误抛出');
    assert.equal(await countChunks('s-1'), 2, '中断后旧 chunk 必须完整保留（不被半删）');
    assert.equal(await countEvidence('s-1'), 1, '中断后 evidence 必须完整保留');
  },
);

test('upsertSourceChunks 正常路径与改造前等价：删旧插新', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { wikiRepo } = await import('./wiki-db');
  const { repo } = await import('./server-db');

  const now = Date.now();
  repo.insertSource({ id: 's-1', title: 'S1', type: 'file', rawContent: '# S1', ingestedAt: now });

  const first = wikiRepo.upsertSourceChunks(
    's-1',
    [makeDraft(0, 'first one'), makeDraft(1, 'first two')],
    now,
  );
  assert.equal(first.length, 2);
  assert.ok(first.every((row) => row.sourceId === 's-1' && row.id && row.createdAt === now));
  assert.equal(await countChunks('s-1'), 2);

  const second = wikiRepo.upsertSourceChunks('s-1', [makeDraft(0, 'second only')], now + 5);
  assert.equal(second.length, 1);
  assert.equal(await countChunks('s-1'), 1, '重新 upsert 应替换为新 chunk 集');
});

test(
  'rebuildAllIndexes 单 source 重建抛错时不清空既有索引（无检索盲区）',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { wikiRepo } = await import('./wiki-db');
    const { repo } = await import('./server-db');

    const now = Date.now();
    repo.insertSource({
      id: 's-1',
      title: 'Alpha',
      type: 'file',
      rawContent: `# Alpha\n\nAlpha theory explains the core idea.`,
      ingestedAt: now,
    });
    repo.insertSource({
      id: 's-2',
      title: 'Beta',
      type: 'file',
      rawContent: `# Beta\n\nBeta theory explains another idea.`,
      ingestedAt: now,
    });
    repo.upsertConcept({
      id: 'c-1',
      title: 'Alpha',
      summary: 'Alpha theory explains the core idea.',
      body: 'Alpha theory body.',
      sources: ['s-1'],
      related: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
      categories: [],
      categoryKeys: [],
    });

    wikiRepo.rebuildAllIndexes();
    const before = await countChunks();
    assert.ok(before >= 1, '首次重建应回填 chunk');

    const realIndexSource = wikiRepo.indexSource.bind(wikiRepo);
    let calls = 0;
    wikiRepo.indexSource = (source) => {
      calls += 1;
      if (calls === 1) throw new Error('injected rebuild failure on first source');
      return realIndexSource(source);
    };

    let threw = false;
    try {
      wikiRepo.rebuildAllIndexes();
    } catch {
      threw = true;
    } finally {
      wikiRepo.indexSource = realIndexSource;
    }

    assert.ok(threw, 'rebuildAllIndexes 应把注入错误抛出');
    assert.equal(
      await countChunks(),
      before,
      '重建中断后既有 chunk 必须保留（无全局 wipe 留下的检索盲区）',
    );
  },
);

test(
  'hardDeleteSource 原子删除工件与 source；删 source 失败时工件不被孤立',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { wikiRepo } = await import('./wiki-db');
    const { repo } = await import('./server-db');

    const now = Date.now();
    repo.insertSource({
      id: 's-1',
      title: 'S1',
      type: 'file',
      rawContent: '# S1',
      ingestedAt: now,
    });
    wikiRepo.upsertSourceChunks('s-1', [makeDraft(0, 'alpha content')], now);
    assert.equal(await countChunks('s-1'), 1);

    const realDeleteSource = repo.deleteSource.bind(repo);
    repo.deleteSource = () => {
      throw new Error('injected deleteSource failure');
    };

    let threw = false;
    try {
      wikiRepo.hardDeleteSource('s-1');
    } catch {
      threw = true;
    } finally {
      repo.deleteSource = realDeleteSource;
    }

    assert.ok(threw, 'hardDeleteSource 应把注入错误抛出');
    assert.equal(await countChunks('s-1'), 1, 'deleteSource 失败时工件必须随事务回滚保留');
    assert.ok(repo.getSource('s-1'), 'source 也应保留（all-or-nothing）');

    wikiRepo.hardDeleteSource('s-1');
    assert.equal(await countChunks('s-1'), 0, '正常路径应删除工件');
    assert.equal(repo.getSource('s-1'), null, '正常路径应删除 source');
  },
);
