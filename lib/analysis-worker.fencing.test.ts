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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-analysis-fence-'));
  const previousEnv = new Map<string, string | undefined>();
  for (const key of [
    'DATA_DIR',
    'LLM_API_KEY',
    'LLM_API_URL',
    'COMPOUND_SKIP_DNS_GUARD',
    'COMPOUND_DISABLE_RELATION_WORKER',
    'COMPOUND_DISABLE_SOURCE_SUMMARY_WORKER',
    'COMPOUND_DISABLE_CATEGORY_WIKI_AUTO_WORKERS',
    'COMPOUND_REVIEW_LARGE_CHANGE_THRESHOLD',
    'COMPOUND_CONTEXTUAL_RETRIEVAL',
    'COMPOUND_EMBEDDING_PROVIDER',
    'COMPOUND_EMBEDDING_API_KEY',
    'COMPOUND_EMBEDDING_API_URL',
    'COMPOUND_EMBEDDING_BATCH_SIZE',
  ]) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.DATA_DIR = tempDir;
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  process.env.COMPOUND_DISABLE_CATEGORY_WIKI_AUTO_WORKERS = 'true';
  process.env.COMPOUND_REVIEW_LARGE_CHANGE_THRESHOLD = '1';
  process.env.COMPOUND_CONTEXTUAL_RETRIEVAL = 'on';
  delete process.env.COMPOUND_DISABLE_RELATION_WORKER;
  delete process.env.COMPOUND_DISABLE_SOURCE_SUMMARY_WORKER;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function tableCount(
  db: { prepare: (sql: string) => { get: () => unknown } },
  table: string,
): number {
  try {
    return Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number } | undefined)?.c || 0,
    );
  } catch {
    return 0;
  }
}

function stealLease(
  db: { prepare: (sql: string) => { run: (version: number, id: string) => unknown } },
  jobId: string,
  nextVersion: number,
) {
  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', locked_by = 'worker-b', lease_version = ?
      WHERE id = ?`,
  ).run(nextVersion, jobId);
}

async function withMockFetch<T>(mockFetch: typeof fetch, fn: () => Promise<T> | T): Promise<T> {
  const previous = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = previous;
  }
}

function llmJson(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: JSON.stringify(payload) },
          finish_reason: 'stop',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

test('stale analysis lease writes nothing to source/concept/relation/evidence/review', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { applyFencedAnalysisEffects, ensureAnalysisWorkerSchema, queueAdvancedAnalysisJob } =
    await import('./analysis-worker');

  ensureAnalysisWorkerSchema();
  wikiRepo.ensureSchema();
  const now = Date.now();
  repo.insertSource({
    id: 's-held',
    title: 'Held',
    type: 'file',
    rawContent: '# Held',
    ingestedAt: now,
  });
  repo.upsertConcept({
    id: 'c-a',
    title: 'A',
    summary: 'a',
    body: 'body a',
    sources: ['s-held'],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  repo.upsertConcept({
    id: 'c-b',
    title: 'B',
    summary: 'b',
    body: 'body b',
    sources: ['s-held'],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-held', stage: 'qa_index' });
  const db = getServerDb();
  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'worker-a', lease_version = 1
      WHERE id = ?`,
  ).run(now, now, jobId);
  const staleJob = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof applyFencedAnalysisEffects
  >[0];

  stealLease(db, jobId, 2);

  const before = {
    sources: tableCount(db, 'sources'),
    concepts: tableCount(db, 'concepts'),
    relations: tableCount(db, 'concept_relations'),
    evidence: tableCount(db, 'concept_evidence'),
    review: tableCount(db, 'review_items'),
  };

  const applied = applyFencedAnalysisEffects(staleJob, {
    source: {
      id: 's-from-a',
      title: 'Late source',
      type: 'file',
      rawContent: '# late',
      ingestedAt: now,
    },
    concept: {
      id: 'c-from-a',
      title: 'Late concept',
      summary: 'late',
      body: 'late body',
      sources: ['s-held'],
      related: [],
      categories: [],
      categoryKeys: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    relation: {
      sourceConceptId: 'c-a',
      targetConceptId: 'c-b',
      kind: 'related',
      reason: 'late relation',
      confidence: 0.9,
    },
    evidence: {
      conceptId: 'c-a',
      sourceId: 's-held',
      claim: 'late evidence',
      kind: 'claim',
      confidence: 0.8,
    },
    review: {
      kind: 'manual',
      title: 'late review',
      targetType: 'source',
      targetId: 's-held',
      sourceId: 's-held',
      confidence: 0.2,
    },
  });

  assert.equal(applied, false);
  assert.equal(tableCount(db, 'sources'), before.sources, 'sources must not grow');
  assert.equal(tableCount(db, 'concepts'), before.concepts, 'concepts must not grow');
  assert.equal(tableCount(db, 'concept_relations'), before.relations, 'relations must not grow');
  assert.equal(tableCount(db, 'concept_evidence'), before.evidence, 'evidence must not grow');
  assert.equal(tableCount(db, 'review_items'), before.review, 'review must not grow');
  assert.ok(!repo.getSource('s-from-a'), 'late source insert must not land');
  assert.ok(!repo.getConcept('c-from-a'), 'late concept insert must not land');

  const owned = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.deepEqual(owned, { status: 'running', locked_by: 'worker-b', lease_version: 2 });
});

test('summarize late LLM result writes no source_analysis or review after lease steal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-sum',
    title: 'Summary source',
    type: 'file',
    rawContent: '# Summary body with enough text for the worker',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-sum', stage: 'summarize' });
  const db = getServerDb();

  await withMockFetch(
    async () => {
      stealLease(db, jobId, 9);
      return llmJson({
        summary: 'late summary',
        topics: ['t'],
        entities: ['e'],
        confidence: 0.2,
      });
    },
    async () => {
      const result = await runAnalysisWorkerOnce({ stages: ['summarize'] });
      assert.equal(result.claimed, 1);
    },
  );

  assert.equal(tableCount(db, 'source_analysis'), 0, 'source_analysis must stay empty');
  assert.equal(tableCount(db, 'review_items'), 0, 'review_items must stay empty');
  const row = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(row.status, 'running');
  assert.equal(row.locked_by, 'worker-b');
  assert.equal(row.lease_version, 9);
});

test('relations late LLM result writes no relation or review after lease steal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  const now = Date.now();
  repo.insertSource({
    id: 's-rel',
    title: 'Rel source',
    type: 'file',
    rawContent: '# Rel',
    ingestedAt: now,
  });
  repo.upsertConcept({
    id: 'c-rel-a',
    title: 'Rel A',
    summary: 'a',
    body: 'body a long enough',
    sources: ['s-rel'],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  repo.upsertConcept({
    id: 'c-rel-b',
    title: 'Rel B',
    summary: 'b',
    body: 'body b long enough',
    sources: ['s-rel'],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-rel', stage: 'relations' });
  const db = getServerDb();

  await withMockFetch(
    async () => {
      stealLease(db, jobId, 4);
      return llmJson({
        relations: [
          {
            sourceConceptId: 'c-rel-a',
            targetConceptId: 'c-rel-b',
            kind: 'related',
            reason: 'late high confidence',
            confidence: 0.95,
          },
          {
            sourceConceptId: 'c-rel-a',
            targetConceptId: 'c-rel-b',
            kind: 'supports',
            reason: 'late low confidence',
            confidence: 0.4,
          },
        ],
      });
    },
    async () => {
      await runAnalysisWorkerOnce({ stages: ['relations'] });
    },
  );

  assert.equal(tableCount(db, 'concept_relations'), 0, 'concept_relations must stay empty');
  assert.equal(tableCount(db, 'review_items'), 0, 'relation review must stay empty');
  const a = repo.getConcept('c-rel-a');
  const b = repo.getConcept('c-rel-b');
  assert.deepEqual(a?.related ?? [], []);
  assert.deepEqual(b?.related ?? [], []);
  const row = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(row.locked_by, 'worker-b');
  assert.equal(row.lease_version, 4);
  assert.equal(row.status, 'running');
});

function createLatch() {
  let reached!: () => void;
  let release!: () => void;
  const atGate = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    atGate,
    released,
    signalReached: () => reached(),
    release: () => release(),
  };
}

function snapshotBusiness(db: {
  prepare: (sql: string) => { get: () => unknown };
}): Record<string, number> {
  return {
    sources: tableCount(db, 'sources'),
    concepts: tableCount(db, 'concepts'),
    chunks: tableCount(db, 'source_chunks'),
    evidence: tableCount(db, 'concept_evidence'),
    relations: tableCount(db, 'concept_relations'),
    review: tableCount(db, 'review_items'),
    activity: tableCount(db, 'activity'),
  };
}

test('github ingest persist rolls back when lease is stolen after LLM', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  const now = Date.now();
  repo.upsertConcept({
    id: 'c-exist',
    title: 'Existing',
    summary: 'existing',
    body: 'existing body',
    sources: [],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  syncObs.startRun({
    id: 'sr-ingest-fence',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-ingest-fence',
    runId: 'sr-ingest-fence',
    path: 'notes/alpha.md',
    changeType: 'create',
    status: 'queued',
    stage: 'ingest',
  });
  const jobId = queueGithubIngestJob({
    runId: 'sr-ingest-fence',
    itemId: 'sri-ingest-fence',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/alpha.md',
    sha: 'sha-alpha',
    externalKey: 'github:demo/vault:notes/alpha.md@sha-alpha',
    title: 'Alpha',
    rawContent: '# Alpha\n\nAlpha notes with enough body for ingest.',
  });
  const db = getServerDb();
  const before = snapshotBusiness(db);
  const latch = createLatch();
  let takenOverAt = 0;

  await withMockFetch(
    async () => {
      latch.signalReached();
      await latch.released;
      return llmJson({
        newConcepts: [
          {
            title: 'Late Alpha',
            summary: 'late summary',
            body: 'late body',
            relatedConceptIds: ['c-exist'],
            categories: [{ primary: '认知心理学', secondary: '社会认知' }],
          },
        ],
        updatedConcepts: [],
        activitySummary: 'created Late Alpha',
      });
    },
    async () => {
      const worker = runAnalysisWorkerOnce({ stages: ['github_ingest'] });
      await latch.atGate;
      const claimed = db
        .prepare(`SELECT lease_version FROM analysis_jobs WHERE id = ?`)
        .get(jobId) as { lease_version: number };
      assert.ok(claimed.lease_version >= 1);
      takenOverAt = claimed.lease_version + 1;
      stealLease(db, jobId, takenOverAt);
      latch.release();
      await worker;
    },
  );

  assert.deepEqual(snapshotBusiness(db), before);
  const owned = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(owned.status, 'running');
  assert.equal(owned.locked_by, 'worker-b');
  assert.equal(owned.lease_version, takenOverAt);
});

test('embedding late remote batch writes no chunk_embeddings after takeover', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  process.env.COMPOUND_EMBEDDING_PROVIDER = 'remote';
  process.env.COMPOUND_EMBEDDING_API_KEY = 'embedding-key';
  process.env.COMPOUND_EMBEDDING_API_URL = 'https://example.com/v1/embeddings';
  process.env.COMPOUND_EMBEDDING_BATCH_SIZE = '8';

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  repo.insertSource({
    id: 's-embed-fence',
    title: 'Embed',
    type: 'file',
    rawContent: '# Embed\n\nFirst paragraph for vectors.\n\nSecond paragraph for vectors.',
    ingestedAt: Date.now(),
  });
  wikiRepo.indexSource(repo.getSource('s-embed-fence')!);
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-embed-fence', stage: 'embedding' });
  const db = getServerDb();
  const before = tableCount(db, 'chunk_embeddings');
  const latch = createLatch();
  let takenOverAt = 0;

  await withMockFetch(
    async () => {
      latch.signalReached();
      await latch.released;
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
    async () => {
      const worker = runAnalysisWorkerOnce({ stages: ['embedding'] });
      await latch.atGate;
      const claimed = db
        .prepare(`SELECT lease_version FROM analysis_jobs WHERE id = ?`)
        .get(jobId) as { lease_version: number };
      takenOverAt = claimed.lease_version + 1;
      stealLease(db, jobId, takenOverAt);
      latch.release();
      await worker;
    },
  );

  assert.equal(tableCount(db, 'chunk_embeddings'), before);
  const owned = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(owned.status, 'running');
  assert.equal(owned.locked_by, 'worker-b');
  assert.equal(owned.lease_version, takenOverAt);
});

test('embedding later batches write nothing after takeover of an earlier batch', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  process.env.COMPOUND_EMBEDDING_PROVIDER = 'remote';
  process.env.COMPOUND_EMBEDDING_API_KEY = 'embedding-key';
  process.env.COMPOUND_EMBEDDING_API_URL = 'https://example.com/v1/embeddings';
  process.env.COMPOUND_EMBEDDING_BATCH_SIZE = '1';

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  const db = getServerDb();
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO source_chunks
      (id, source_id, chunk_index, heading, heading_path, content, token_count, content_hash, created_at, updated_at, contextual_prefix)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  repo.insertSource({
    id: 's-embed-multi',
    title: 'Multi',
    type: 'file',
    rawContent: '# Multi',
    ingestedAt: now,
  });
  insert.run('ch-1', 's-embed-multi', 0, 'H', '[]', 'chunk one', 2, 'hash-1', now, now, null);
  insert.run('ch-2', 's-embed-multi', 1, 'H', '[]', 'chunk two', 2, 'hash-2', now, now, null);
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-embed-multi', stage: 'embedding' });
  let fetchIndex = 0;
  let takenOverAt = 0;

  await withMockFetch(
    async () => {
      fetchIndex += 1;
      if (fetchIndex === 2) {
        const claimed = db
          .prepare(`SELECT lease_version FROM analysis_jobs WHERE id = ?`)
          .get(jobId) as { lease_version: number };
        takenOverAt = claimed.lease_version + 1;
        stealLease(db, jobId, takenOverAt);
      }
      return new Response(JSON.stringify({ data: [{ embedding: [fetchIndex, 0, 0] }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    async () => {
      await runAnalysisWorkerOnce({ stages: ['embedding'] });
    },
  );

  const stored = db
    .prepare(`SELECT chunk_id FROM chunk_embeddings WHERE source_id = ? ORDER BY chunk_id`)
    .all('s-embed-multi') as Array<{ chunk_id: string }>;
  assert.deepEqual(
    stored.map((row) => row.chunk_id),
    ['ch-1'],
  );
  const owned = db
    .prepare(`SELECT status, locked_by FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string };
  assert.equal(owned.status, 'running');
  assert.equal(owned.locked_by, 'worker-b');
});

test('contextualize late prefixes do not apply after takeover', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  repo.insertSource({
    id: 's-ctx-fence',
    title: 'Ctx',
    type: 'file',
    rawContent: '# Ctx\n\nA chunk that needs a prefix for retrieval.',
    ingestedAt: Date.now(),
  });
  wikiRepo.indexSource(repo.getSource('s-ctx-fence')!);
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-ctx-fence', stage: 'contextualize' });
  const db = getServerDb();
  const before = db
    .prepare(
      `SELECT COUNT(*) AS c FROM source_chunks WHERE source_id = ? AND contextual_prefix IS NOT NULL AND contextual_prefix != ''`,
    )
    .get('s-ctx-fence') as { c: number };
  const latch = createLatch();
  let takenOverAt = 0;

  await withMockFetch(
    async () => {
      latch.signalReached();
      await latch.released;
      const chunks = db
        .prepare(`SELECT id FROM source_chunks WHERE source_id = ?`)
        .all('s-ctx-fence') as Array<{ id: string }>;
      const payload: Record<string, string> = {};
      for (const chunk of chunks) payload[chunk.id] = 'late prefix that must not land';
      return llmJson(payload);
    },
    async () => {
      const worker = runAnalysisWorkerOnce({ stages: ['contextualize'] });
      await latch.atGate;
      const claimed = db
        .prepare(`SELECT lease_version FROM analysis_jobs WHERE id = ?`)
        .get(jobId) as { lease_version: number };
      takenOverAt = claimed.lease_version + 1;
      stealLease(db, jobId, takenOverAt);
      latch.release();
      await worker;
    },
  );

  const after = db
    .prepare(
      `SELECT COUNT(*) AS c FROM source_chunks WHERE source_id = ? AND contextual_prefix IS NOT NULL AND contextual_prefix != ''`,
    )
    .get('s-ctx-fence') as { c: number };
  assert.equal(after.c, before.c);
  const owned = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(owned.status, 'running');
  assert.equal(owned.locked_by, 'worker-b');
  assert.equal(owned.lease_version, takenOverAt);
});

test('finalizeLegacyIfPossible notifies webhook terminal so B can start', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, finalizeLegacyIfPossible } = await import('./analysis-worker');
  const { setGithubSyncLoopRunnerForTests, startGithubSyncFromWebhook } =
    await import('./github-sync-runner');
  t.after(() => setGithubSyncLoopRunnerForTests(null));

  let leaveFirstRunning = true;
  const startedJobs: string[] = [];
  setGithubSyncLoopRunnerForTests(async (jobId) => {
    startedJobs.push(jobId);
    if (leaveFirstRunning) {
      leaveFirstRunning = false;
      return;
    }
    repo.updateSyncJob(jobId, { status: 'done', finished_at: Date.now(), current: 'injected' });
  });

  const a = startGithubSyncFromWebhook({
    deliveryId: 'delivery-legacy-a',
    event: 'push',
    signatureSha256: 'sha256=legacy-a',
    ref: 'refs/heads/main',
    afterSha: 'sha-a',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const b = startGithubSyncFromWebhook({
    deliveryId: 'delivery-legacy-b',
    event: 'push',
    signatureSha256: 'sha256=legacy-b',
    ref: 'refs/heads/main',
    afterSha: 'sha-b',
  });
  assert.equal(a.workerStarted, true);
  assert.equal(b.queued, true);

  syncObs.startRun({
    id: 'sr-legacy-terminal',
    kind: 'github',
    triggerType: 'webhook',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-legacy-terminal',
    runId: 'sr-legacy-terminal',
    path: 'notes/done.md',
    changeType: 'update',
    status: 'succeeded',
    stage: 'complete',
  });
  queueAdvancedAnalysisJob({
    runId: 'sr-legacy-terminal',
    itemId: 'sri-legacy-terminal',
    sourceId: 's-legacy-terminal',
    sourcePath: 'notes/done.md',
    stage: 'github_ingest',
    payload: { legacyJobId: a.jobId, path: 'notes/done.md' },
  });

  finalizeLegacyIfPossible('sr-legacy-terminal');
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
  for (let i = 0; i < 40; i += 1) {
    const holder = globalThis as unknown as { __activeSyncPromises?: Set<Promise<void>> };
    const pending = [...(holder.__activeSyncPromises ?? [])];
    if (pending.length === 0) break;
    await Promise.allSettled(pending);
  }

  const db = getServerDb();
  const deliveryA = db
    .prepare(`SELECT status, job_id FROM webhook_deliveries WHERE delivery_id = ?`)
    .get('delivery-legacy-a') as { status: string; job_id: string };
  const deliveryB = db
    .prepare(`SELECT status, job_id FROM webhook_deliveries WHERE delivery_id = ?`)
    .get('delivery-legacy-b') as { status: string; job_id: string | null };
  assert.equal(deliveryA.status, 'processed');
  assert.equal(deliveryA.job_id, a.jobId);
  assert.ok(deliveryB.job_id);
  assert.notEqual(deliveryB.job_id, a.jobId);
  assert.ok(startedJobs.includes(deliveryB.job_id!));
  assert.equal(repo.getSyncJob(a.jobId)?.status, 'done');
});

function openPeerDb() {
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');
  const peer = new Database(path.join(process.env.DATA_DIR as string, 'compound.db'));
  peer.pragma('journal_mode = WAL');
  peer.pragma('busy_timeout = 50');
  return peer;
}

test('IMMEDIATE lease txn blocks peer takeover until A commits or A writes zero after lost lease', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, withAnalysisJobLease } = await import('./analysis-worker');

  repo.insertSource({
    id: 's-lock',
    title: 'Lock',
    type: 'file',
    rawContent: '# Lock',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-lock', stage: 'qa_index' });
  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'worker-a', lease_version = 1
      WHERE id = ?`,
  ).run(ts, ts, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof withAnalysisJobLease
  >[0];

  const peer = openPeerDb();
  t.after(() => peer.close());

  let peerTookOverWhileAHeld = false;
  const applied = withAnalysisJobLease(job, () => {
    try {
      peer
        .prepare(`UPDATE analysis_jobs SET locked_by = 'worker-b', lease_version = 2 WHERE id = ?`)
        .run(jobId);
      peerTookOverWhileAHeld = true;
    } catch (err) {
      assert.match(String(err), /busy|locked/i);
    }
    repo.insertSource({
      id: 's-from-a-lock',
      title: 'A under writer lock',
      type: 'file',
      rawContent: '# a',
      ingestedAt: ts,
    });
    return true;
  });

  assert.equal(applied, true);
  assert.equal(peerTookOverWhileAHeld, false, 'B must not steal lease while A holds IMMEDIATE');
  assert.ok(repo.getSource('s-from-a-lock'), 'A may commit business writes under its writer lock');

  peer.pragma('busy_timeout = 1000');
  peer
    .prepare(`UPDATE analysis_jobs SET locked_by = 'worker-b', lease_version = 2 WHERE id = ?`)
    .run(jobId);
  const after = db
    .prepare(`SELECT locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { locked_by: string; lease_version: number };
  assert.equal(after.locked_by, 'worker-b');
  assert.equal(after.lease_version, 2);

  const late = withAnalysisJobLease(job, () => {
    repo.insertSource({
      id: 's-late-a',
      title: 'Late A',
      type: 'file',
      rawContent: '# late',
      ingestedAt: ts,
    });
    return true;
  });
  assert.equal(late, null);
  assert.ok(!repo.getSource('s-late-a'));
});

test('post-ingest metadata and follow-up jobs do not land after lease steal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob, runAnalysisWorkerOnce } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  syncObs.startRun({
    id: 'sr-post-ingest',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-post-ingest',
    runId: 'sr-post-ingest',
    path: 'notes/post.md',
    changeType: 'create',
    status: 'queued',
    stage: 'ingest',
  });
  const jobId = queueGithubIngestJob({
    runId: 'sr-post-ingest',
    itemId: 'sri-post-ingest',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/post.md',
    sha: 'sha-post',
    externalKey: 'github:demo/vault:notes/post.md@sha-post',
    title: 'Post',
    rawContent: '# Post\n\nBody for ingest then steal before metadata.',
  });
  const db = getServerDb();

  await withMockFetch(
    async () => {
      queueMicrotask(() => {
        const claimed = db
          .prepare(`SELECT lease_version FROM analysis_jobs WHERE id = ?`)
          .get(jobId) as { lease_version: number };
        stealLease(db, jobId, claimed.lease_version + 1);
      });
      return llmJson({
        newConcepts: [
          { title: 'PostConcept', summary: 'p', body: 'p body', relatedConceptIds: [] },
        ],
        updatedConcepts: [],
        activitySummary: 'created PostConcept',
      });
    },
    async () => {
      await runAnalysisWorkerOnce({ stages: ['github_ingest'] });
    },
  );

  const owned = db
    .prepare(`SELECT status, locked_by FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string };
  assert.equal(owned.status, 'running');
  assert.equal(owned.locked_by, 'worker-b');

  const files = db
    .prepare(`SELECT COUNT(*) AS c FROM source_file_state WHERE path = ?`)
    .get('notes/post.md') as { c: number };
  assert.equal(files.c, 0, 'late A must not mark source_file_state active');

  const item = db
    .prepare(`SELECT source_id, stage FROM sync_run_items WHERE id = ?`)
    .get('sri-post-ingest') as { source_id: string | null; stage: string };
  assert.equal(item.source_id, null, 'late A must not attach source_id to the run item');
  assert.notEqual(item.stage, 'enhance');

  const followUps = db
    .prepare(
      `SELECT COUNT(*) AS c FROM analysis_jobs WHERE source_path = ? AND stage IN ('summarize', 'embedding', 'relations', 'contextualize')`,
    )
    .get('notes/post.md') as { c: number };
  assert.equal(followUps.c, 0, 'late A must not queue enhancement jobs');
  assert.equal(tableCount(db, 'review_items'), 0);
});

function claimAsWorkerA(jobId: string) {
  const { getServerDb } = require('./server-db') as typeof import('./server-db');
  const db = getServerDb();
  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs
        SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'worker-a', lease_version = 1
      WHERE id = ?`,
  ).run(ts, ts, jobId);
  return db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId);
}

test('fallback github blob upsert is fenced after remote fetch', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  const previousGithub = {
    token: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH,
  };
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.GITHUB_REPO = 'demo/vault';
  process.env.GITHUB_BRANCH = 'main';
  t.after(() => {
    if (previousGithub.token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousGithub.token;
    if (previousGithub.repo === undefined) delete process.env.GITHUB_REPO;
    else process.env.GITHUB_REPO = previousGithub.repo;
    if (previousGithub.branch === undefined) delete process.env.GITHUB_BRANCH;
    else process.env.GITHUB_BRANCH = previousGithub.branch;
  });

  const { getServerDb } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob, resolveGithubIngestRawContent, JobLeaseLostError } =
    await import('./analysis-worker');

  syncObs.startRun({
    id: 'sr-blob-fetch',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  const jobId = queueGithubIngestJob({
    runId: 'sr-blob-fetch',
    itemId: 'sri-blob-fetch',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/remote.md',
    sha: 'sha-remote',
    externalKey: 'github:demo/vault:notes/remote.md@sha-remote',
    title: 'Remote',
  });
  const job = claimAsWorkerA(jobId) as Parameters<typeof resolveGithubIngestRawContent>[1];
  const db = getServerDb();
  const before = tableCount(db, 'analysis_payload_blobs');
  const latch = createLatch();

  await withMockFetch(
    async () => {
      latch.signalReached();
      await latch.released;
      return new Response('# remote markdown', {
        status: 200,
        headers: { 'content-length': '17' },
      });
    },
    async () => {
      const pending = resolveGithubIngestRawContent(
        JSON.parse(
          (
            db.prepare(`SELECT payload_json FROM analysis_jobs WHERE id = ?`).get(jobId) as {
              payload_json: string;
            }
          ).payload_json,
        ),
        job,
      );
      await latch.atGate;
      stealLease(db, jobId, 2);
      latch.release();
      await assert.rejects(pending, (err: unknown) => err instanceof JobLeaseLostError);
    },
  );

  assert.equal(tableCount(db, 'analysis_payload_blobs'), before);
  const owned = db
    .prepare(`SELECT locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { locked_by: string; lease_version: number };
  assert.equal(owned.locked_by, 'worker-b');
  assert.equal(owned.lease_version, 2);
});

test('getGithubIngestRawContent does not touch last_used_at after takeover', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { queueGithubIngestJob, getGithubIngestRawContent, JobLeaseLostError } =
    await import('./analysis-worker');

  const jobId = queueGithubIngestJob({
    runId: 'sr-blob-touch',
    itemId: 'sri-blob-touch',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/touch.md',
    sha: 'sha-touch',
    externalKey: 'github:demo/vault:notes/touch.md@sha-touch',
    title: 'Touch',
    rawContent: '# cached body',
  });
  const job = claimAsWorkerA(jobId) as Parameters<typeof getGithubIngestRawContent>[1];
  const db = getServerDb();
  const payload = JSON.parse(
    (
      db.prepare(`SELECT payload_json FROM analysis_jobs WHERE id = ?`).get(jobId) as {
        payload_json: string;
      }
    ).payload_json,
  );
  db.prepare(`UPDATE analysis_payload_blobs SET last_used_at = 111 WHERE ref = ?`).run(
    payload.rawContentRef,
  );
  stealLease(db, jobId, 2);
  assert.throws(
    () => getGithubIngestRawContent(payload, job),
    (err: unknown) => err instanceof JobLeaseLostError,
  );
  const blob = db
    .prepare(`SELECT last_used_at FROM analysis_payload_blobs WHERE ref = ?`)
    .get(payload.rawContentRef) as { last_used_at: number };
  assert.equal(blob.last_used_at, 111);
});

test('fail/empty/cancel late A writes no blob, run item, or legacy job', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob, failJob, failJobPermanently, processGithubIngest } =
    await import('./analysis-worker');

  repo.insertSyncJob({
    id: 'job-legacy-fence',
    kind: 'github',
    status: 'running',
    total: 1,
    done: 0,
    failed: 0,
    current: '分析中',
    log: '[]',
    error: null,
    started_at: Date.now(),
    finished_at: null,
  });
  syncObs.startRun({
    id: 'sr-fail-fence',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-fail-fence',
    runId: 'sr-fail-fence',
    path: 'notes/fail.md',
    changeType: 'create',
    status: 'running',
    stage: 'llm',
  });
  const jobId = queueGithubIngestJob({
    runId: 'sr-fail-fence',
    itemId: 'sri-fail-fence',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/fail.md',
    sha: 'sha-fail',
    externalKey: 'github:demo/vault:notes/fail.md@sha-fail',
    title: 'Fail',
    rawContent: '   ',
    legacyJobId: 'job-legacy-fence',
  });
  const job = claimAsWorkerA(jobId) as Parameters<typeof failJob>[0];
  const db = getServerDb();
  const blobBefore = tableCount(db, 'analysis_payload_blobs');
  stealLease(db, jobId, 2);

  failJob(job, new Error('late boom'));
  failJobPermanently(job, 'late permanent');
  const { JobLeaseLostError } = await import('./analysis-worker');
  await assert.rejects(
    () => processGithubIngest(job),
    (err: unknown) => err instanceof JobLeaseLostError,
  );

  assert.equal(tableCount(db, 'analysis_payload_blobs'), blobBefore);
  const afterJob = db
    .prepare(`SELECT status, locked_by, lease_version FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { status: string; locked_by: string; lease_version: number };
  assert.equal(afterJob.status, 'running');
  assert.equal(afterJob.locked_by, 'worker-b');
  assert.equal(afterJob.lease_version, 2);
  const item = db
    .prepare(`SELECT status, stage FROM sync_run_items WHERE id = ?`)
    .get('sri-fail-fence') as { status: string; stage: string };
  assert.equal(item.status, 'running');
  assert.equal(item.stage, 'llm');
  const legacy = repo.getSyncJob('job-legacy-fence')!;
  assert.equal(legacy.status, 'running');
  assert.equal(legacy.done, 0);
  assert.equal(legacy.failed, 0);
  assert.equal(tableCount(db, 'sources'), 0);
});

test('heartbeat does not update run metadata after lease steal', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueAdvancedAnalysisJob, refreshJobHeartbeat } = await import('./analysis-worker');

  syncObs.startRun({
    id: 'sr-hb',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-hb',
    runId: 'sr-hb',
    path: 'notes/hb.md',
    changeType: 'update',
    status: 'queued',
    stage: 'queued',
  });
  const { repo } = await import('./server-db');
  repo.insertSource({
    id: 's-hb',
    title: 'HB',
    type: 'file',
    rawContent: '# hb',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({
    runId: 'sr-hb',
    itemId: 'sri-hb',
    sourceId: 's-hb',
    sourcePath: 'notes/hb.md',
    stage: 'qa_index',
  });
  const job = claimAsWorkerA(jobId) as Parameters<typeof refreshJobHeartbeat>[0];
  const db = getServerDb();
  const beforeHb = db.prepare(`SELECT heartbeat_at FROM analysis_jobs WHERE id = ?`).get(jobId) as {
    heartbeat_at: number | null;
  };
  stealLease(db, jobId, 2);
  assert.equal(refreshJobHeartbeat(job), false);
  const afterHb = db
    .prepare(`SELECT heartbeat_at, locked_by FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as { heartbeat_at: number | null; locked_by: string };
  assert.equal(afterHb.heartbeat_at, beforeHb.heartbeat_at);
  assert.equal(afterHb.locked_by, 'worker-b');
  const item = db
    .prepare(`SELECT status, stage FROM sync_run_items WHERE id = ?`)
    .get('sri-hb') as { status: string; stage: string };
  assert.equal(item.status, 'queued');
  assert.equal(item.stage, 'queued');
});

test('heartbeat IMMEDIATE txn blocks peer takeover', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, refreshJobHeartbeat, withAnalysisJobLease } =
    await import('./analysis-worker');
  const Database = require('better-sqlite3') as typeof import('better-sqlite3');

  repo.insertSource({
    id: 's-hb-lock',
    title: 'HB lock',
    type: 'file',
    rawContent: '# hb',
    ingestedAt: Date.now(),
  });
  const jobId = queueAdvancedAnalysisJob({ sourceId: 's-hb-lock', stage: 'qa_index' });
  const job = claimAsWorkerA(jobId) as Parameters<typeof refreshJobHeartbeat>[0];
  const peer = new Database(path.join(process.env.DATA_DIR as string, 'compound.db'));
  peer.pragma('journal_mode = WAL');
  peer.pragma('busy_timeout = 50');
  t.after(() => peer.close());

  let peerTookOverWhileAHeld = false;
  withAnalysisJobLease(job, () => {
    try {
      peer
        .prepare(`UPDATE analysis_jobs SET locked_by = 'worker-b', lease_version = 2 WHERE id = ?`)
        .run(jobId);
      peerTookOverWhileAHeld = true;
    } catch (err) {
      assert.match(String(err), /busy|locked/i);
    }
    return refreshJobHeartbeat(job);
  });
  assert.equal(peerTookOverWhileAHeld, false);
});

test('processGithubIngest does not write run item/event or ingest after takeover', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob, processGithubIngest } = await import('./analysis-worker');

  syncObs.startRun({
    id: 'sr-pre-ingest-obs',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-pre-ingest-obs',
    runId: 'sr-pre-ingest-obs',
    path: 'notes/pre.md',
    changeType: 'create',
    status: 'queued',
    stage: 'ingest',
  });
  const jobId = queueGithubIngestJob({
    runId: 'sr-pre-ingest-obs',
    itemId: 'sri-pre-ingest-obs',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/pre.md',
    sha: 'sha-pre',
    externalKey: 'github:demo/vault:notes/pre.md@sha-pre',
    title: 'Pre',
    rawContent: '# Pre ingest body with enough markdown.',
  });
  const db = getServerDb();
  const job = claimAsWorkerA(jobId) as Parameters<typeof processGithubIngest>[0];
  const payload = JSON.parse(
    (
      db.prepare(`SELECT payload_json FROM analysis_jobs WHERE id = ?`).get(jobId) as {
        payload_json: string;
      }
    ).payload_json,
  ) as { rawContentRef?: string };
  db.prepare(`UPDATE analysis_jobs SET payload_json = ? WHERE id = ?`).run(
    JSON.stringify({ ...payload, rawContent: '# Pre ingest body with enough markdown.' }),
    jobId,
  );
  const jobWithInline = db
    .prepare(`SELECT * FROM analysis_jobs WHERE id = ?`)
    .get(jobId) as Parameters<typeof processGithubIngest>[0];
  stealLease(db, jobId, 2);

  let ingestFetch = 0;
  await withMockFetch(
    async () => {
      ingestFetch += 1;
      return llmJson({
        newConcepts: [{ title: 'ShouldNotLand', summary: 'x', body: 'x', relatedConceptIds: [] }],
        updatedConcepts: [],
        activitySummary: 'no',
      });
    },
    async () => {
      await processGithubIngest(jobWithInline);
    },
  );

  assert.equal(ingestFetch, 0, 'must not call ingest LLM after lease loss');
  const item = db
    .prepare(`SELECT status, stage FROM sync_run_items WHERE id = ?`)
    .get('sri-pre-ingest-obs') as { status: string; stage: string };
  assert.equal(item.status, 'queued');
  assert.equal(item.stage, 'ingest');
  const events = db
    .prepare(`SELECT COUNT(*) AS c FROM sync_events WHERE message LIKE '%开始 LLM 摄入%'`)
    .get() as { c: number };
  assert.equal(events.c, 0);
  assert.equal(tableCount(db, 'sources'), 0);
});

test('processGithubIngest writes run item/event while lease held', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { syncObs } = await import('./sync-observability');
  const { queueGithubIngestJob, processGithubIngest } = await import('./analysis-worker');

  wikiRepo.ensureSchema();
  syncObs.startRun({
    id: 'sr-pre-ingest-held',
    kind: 'github',
    triggerType: 'manual',
    repo: 'demo/vault',
    branch: 'main',
  });
  syncObs.upsertRunItem({
    id: 'sri-pre-ingest-held',
    runId: 'sr-pre-ingest-held',
    path: 'notes/held.md',
    changeType: 'create',
    status: 'queued',
    stage: 'ingest',
  });
  const jobId = queueGithubIngestJob({
    runId: 'sr-pre-ingest-held',
    itemId: 'sri-pre-ingest-held',
    repoSlug: 'demo/vault',
    branch: 'main',
    path: 'notes/held.md',
    sha: 'sha-held',
    externalKey: 'github:demo/vault:notes/held.md@sha-held',
    title: 'Held',
    rawContent: '# Held ingest body with enough markdown.',
  });
  const job = claimAsWorkerA(jobId) as Parameters<typeof processGithubIngest>[0];

  await withMockFetch(
    async () =>
      llmJson({
        newConcepts: [
          { title: 'HeldConcept', summary: 'h', body: 'h body', relatedConceptIds: [] },
        ],
        updatedConcepts: [],
        activitySummary: 'created HeldConcept',
      }),
    async () => {
      await processGithubIngest(job);
    },
  );

  const db = getServerDb();
  const item = db
    .prepare(`SELECT status, stage FROM sync_run_items WHERE id = ?`)
    .get('sri-pre-ingest-held') as { status: string; stage: string };
  assert.ok(item.stage === 'llm' || item.stage === 'enhance' || item.stage === 'complete');
  const events = db
    .prepare(`SELECT COUNT(*) AS c FROM sync_events WHERE message LIKE '%开始 LLM 摄入%'`)
    .get() as { c: number };
  assert.equal(events.c, 1);
  assert.ok(tableCount(db, 'sources') >= 1);
});
