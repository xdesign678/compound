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

test('category wiki run never persists custom LLM credentials', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { createCategoryWikiRun } = await import('./category-wiki-worker');
  const { getServerDb } = await import('./server-db');
  const runId = createCategoryWikiRun({
    primary: '安全',
    secondary: '秘密管理',
    llmConfig: {
      apiKey: 'sk-must-not-be-persisted',
      apiUrl: 'https://llm.example.test/v1/chat/completions',
      model: 'private-model',
    },
  });

  const row = getServerDb()
    .prepare('SELECT request_json FROM category_wiki_runs WHERE id = ?')
    .get(runId) as { request_json: string };
  assert.deepEqual(JSON.parse(row.request_json), {
    primary: '安全',
    secondary: '秘密管理',
  });
  assert.equal(row.request_json.includes('sk-must-not-be-persisted'), false);
});

test('category wiki active-run uniqueness is enforced by SQLite', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { createCategoryWikiRun } = await import('./category-wiki-worker');
  const { getServerDb } = await import('./server-db');
  const first = createCategoryWikiRun({ primary: '工程', secondary: '并发' });
  const second = createCategoryWikiRun({ primary: '工程', secondary: '并发' });

  assert.equal(second, first);
  const count = getServerDb()
    .prepare(
      `SELECT COUNT(*) AS count
         FROM category_wiki_runs
        WHERE primary_category = ? AND secondary_category = ? AND status = 'running'`,
    )
    .get('工程', '并发') as { count: number };
  assert.equal(count.count, 1);
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

test('drain abort leaves category wiki running without writing wiki body', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  process.env.LLM_API_KEY = 'server-key';
  process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';

  const { repo } = await import('./server-db');
  const {
    createCategoryWikiRun,
    getCategoryWiki,
    getCategoryWikiRunStatus,
    startCategoryWikiWorker,
  } = await import('./category-wiki-worker');
  const { drainProcess, resetProcessDrainForTests } = await import('./process-drain');
  const { resetProcessReadinessForTests } = await import('./process-readiness');
  t.after(() => {
    resetProcessReadinessForTests();
    resetProcessDrainForTests();
  });

  const now = Date.now();
  repo.upsertConcept({
    id: 'c-drain-wiki',
    title: 'Drain wiki',
    summary: 'drain',
    body: 'drain body',
    sources: [],
    related: [],
    categories: [{ primary: '测试', secondary: '停机' }],
    categoryKeys: ['测试', '测试/停机'],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  const runId = createCategoryWikiRun({ primary: '测试', secondary: '停机' });
  let reached!: () => void;
  const atFetch = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const previousFetch = global.fetch;
  global.fetch = (async (_input, init) => {
    reached();
    const signal = init?.signal;
    await new Promise<never>((_, reject) => {
      const fail = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail, { once: true });
    });
    return new Response('unreachable');
  }) as typeof fetch;
  t.after(() => {
    global.fetch = previousFetch;
  });

  startCategoryWikiWorker(runId);
  await atFetch;
  await drainProcess('SIGTERM', {
    delay: () => new Promise(() => {}),
    timeoutMs: 10_000,
    closeDatabase: () => {},
    killProcess: () => {},
    exitProcess: () => {},
  });

  assert.equal(getCategoryWiki('测试', '停机'), null);
  const status = getCategoryWikiRunStatus(runId);
  assert.equal(status?.status, 'running');
});

test('autoQueue persistGuard shares IMMEDIATE txn with category_wiki_runs insert', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo, getServerDb } = await import('./server-db');
  const { autoQueueCategoryWikis } = await import('./category-wiki-worker');
  const { persistGuardForJob, queueAdvancedAnalysisJob, JobLeaseLostError } =
    await import('./analysis-worker');
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const now = Date.now();
  repo.upsertConcept({
    id: 'c-queue-lease',
    title: 'Queue lease',
    summary: 'q',
    body: 'q body',
    sources: [],
    related: [],
    categories: [{ primary: '测试', secondary: '排队' }],
    categoryKeys: ['测试', '测试/排队'],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  repo.insertSource({
    id: 's-queue-lease',
    title: 'Q',
    type: 'file',
    rawContent: '# q',
    ingestedAt: now,
  });
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-queue-lease', stage: 'qa_index' });
  const db = getServerDb();
  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'worker-a', lease_version = 1
      WHERE id = ?`,
  ).run(now, now, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof persistGuardForJob
  >[0];

  db.prepare(`UPDATE analysis_jobs SET locked_by = 'worker-b', lease_version = 2 WHERE id = ?`).run(
    jobId,
  );
  const before = Number(
    (db.prepare(`SELECT COUNT(*) AS c FROM category_wiki_runs`).get() as { c: number }).c,
  );
  assert.throws(
    () =>
      autoQueueCategoryWikis({
        conceptIds: ['c-queue-lease'],
        startWorkers: false,
        persistGuard: persistGuardForJob(job),
      }),
    (err: unknown) => err instanceof JobLeaseLostError,
  );
  const afterSteal = Number(
    (db.prepare(`SELECT COUNT(*) AS c FROM category_wiki_runs`).get() as { c: number }).c,
  );
  assert.equal(afterSteal, before);

  db.prepare(`UPDATE analysis_jobs SET locked_by = 'worker-a', lease_version = 1 WHERE id = ?`).run(
    jobId,
  );
  const peer = new Database(path.join(process.env.DATA_DIR as string, 'compound.db'));
  peer.pragma('journal_mode = WAL');
  peer.pragma('busy_timeout = 50');
  t.after(() => peer.close());
  let peerTookOverWhileAHeld = false;
  const queued = autoQueueCategoryWikis({
    conceptIds: ['c-queue-lease'],
    startWorkers: false,
    persistGuard: () => {
      persistGuardForJob(job)();
      try {
        peer
          .prepare(
            `UPDATE analysis_jobs SET locked_by = 'worker-b', lease_version = 2 WHERE id = ?`,
          )
          .run(jobId);
        peerTookOverWhileAHeld = true;
      } catch (err) {
        assert.match(String(err), /busy|locked/i);
      }
    },
  });
  assert.equal(peerTookOverWhileAHeld, false);
  assert.equal(queued.queued, 1);
});
