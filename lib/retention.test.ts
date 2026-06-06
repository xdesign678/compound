import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
  delete (globalThis as Record<string, unknown>).__compound_retention_last_run__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-retention-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test('runRetention caps sync_events / model_runs / stage_cache to maxRows, keeping the newest', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { runRetention } = await import('./retention');
  const { ensureSyncObservabilitySchema } = await import('./sync-observability');
  const { ensureAnalysisWorkerSchema } = await import('./analysis-worker');
  const { ensureWikiCompilerSchema } = await import('./wiki-db');
  ensureSyncObservabilitySchema();
  ensureAnalysisWorkerSchema();
  ensureWikiCompilerSchema();
  const db = getServerDb();

  const base = Date.now();
  const insertEvent = db.prepare(
    `INSERT INTO sync_events (id, run_id, item_id, at, level, stage, path, message, meta)
     VALUES (?, NULL, NULL, ?, 'info', 'llm', NULL, 'm', NULL)`,
  );
  const insertRun = db.prepare(
    `INSERT INTO model_runs (id, model, task, created_at) VALUES (?, 'm', 't', ?)`,
  );
  const insertCache = db.prepare(
    `INSERT INTO source_analysis_stage_cache
       (source_id, stage, stage_version, model, prompt_version, input_hash, output_hash, status, updated_at)
     VALUES (?, 'qa_index', 'v2', '', '', ?, 'o', 'succeeded', ?)`,
  );
  for (let i = 0; i < 200; i += 1) {
    const ts = base + i * 1000; // strictly increasing → larger i is newer
    insertEvent.run(`ev-${i}`, ts);
    insertRun.run(`mr-${i}`, ts);
    insertCache.run(`src-${i}`, `hash-${i}`, ts);
  }

  const result = runRetention({
    syncEvents: { maxRows: 50, maxAgeDays: 3650 },
    modelRuns: { maxRows: 30, maxAgeDays: 3650 },
    stageCache: { maxRows: 20, maxAgeDays: 3650 },
  });

  const count = (sql: string) => Number((db.prepare(sql).get() as { c: number }).c);
  assert.equal(count(`SELECT COUNT(*) AS c FROM sync_events`), 50);
  assert.equal(count(`SELECT COUNT(*) AS c FROM model_runs`), 30);
  assert.equal(count(`SELECT COUNT(*) AS c FROM source_analysis_stage_cache`), 20);
  assert.equal(result.syncEventsDeleted, 150);
  assert.equal(result.modelRunsDeleted, 170);
  assert.equal(result.stageCacheDeleted, 180);

  // Newest rows survive, oldest are gone.
  const oldestEvent = db.prepare(`SELECT id FROM sync_events WHERE id = 'ev-0'`).get();
  const newestEvent = db.prepare(`SELECT id FROM sync_events WHERE id = 'ev-199'`).get();
  assert.equal(oldestEvent, undefined);
  assert.ok(newestEvent);
});

test('runRetention deletes rows older than maxAgeDays even when under the row cap', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { runRetention } = await import('./retention');
  const { ensureSyncObservabilitySchema } = await import('./sync-observability');
  ensureSyncObservabilitySchema();
  const db = getServerDb();

  const now = Date.now();
  const insertEvent = db.prepare(
    `INSERT INTO sync_events (id, run_id, item_id, at, level, stage, path, message, meta)
     VALUES (?, NULL, NULL, ?, 'info', 'llm', NULL, 'm', NULL)`,
  );
  insertEvent.run('fresh', now - 1 * 24 * 60 * 60 * 1000);
  insertEvent.run('old', now - 40 * 24 * 60 * 60 * 1000);

  const result = runRetention({ syncEvents: { maxRows: 10_000, maxAgeDays: 30 } });

  assert.equal(result.syncEventsDeleted, 1);
  assert.ok(db.prepare(`SELECT id FROM sync_events WHERE id = 'fresh'`).get());
  assert.equal(db.prepare(`SELECT id FROM sync_events WHERE id = 'old'`).get(), undefined);
});

test('runRetention keeps only the newest N concept_versions per concept', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { runRetention } = await import('./retention');
  const { ensureWikiCompilerSchema } = await import('./wiki-db');
  ensureWikiCompilerSchema();
  const db = getServerDb();

  const insert = db.prepare(
    `INSERT INTO concept_versions (id, concept_id, version, previous_body, next_body, source_ids, change_summary, created_at)
     VALUES (?, ?, ?, NULL, 'body', '[]', 'change', ?)`,
  );
  for (let v = 1; v <= 60; v += 1) insert.run(`c1-v${v}`, 'c1', v, Date.now() + v);
  for (let v = 1; v <= 3; v += 1) insert.run(`c2-v${v}`, 'c2', v, Date.now() + v);

  const result = runRetention({ conceptVersionsPerConcept: 10 });

  const count = (concept: string) =>
    Number(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM concept_versions WHERE concept_id = ?`)
          .get(concept) as { c: number }
      ).c,
    );
  assert.equal(count('c1'), 10);
  assert.equal(count('c2'), 3);
  assert.equal(result.conceptVersionsDeleted, 50);
  // The surviving c1 versions are the highest version numbers (51..60).
  assert.ok(db.prepare(`SELECT id FROM concept_versions WHERE id = 'c1-v60'`).get());
  assert.equal(db.prepare(`SELECT id FROM concept_versions WHERE id = 'c1-v50'`).get(), undefined);
});

test('runRetention purges orphan evidence/relations/chunk_embeddings without touching valid rows', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb, repo } = await import('./server-db');
  const { runRetention } = await import('./retention');
  const { wikiRepo } = await import('./wiki-db');
  wikiRepo.ensureSchema();
  const db = getServerDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Valid graph: a source, a concept, a chunk, valid evidence/relation/embedding.
  repo.insertSource({
    id: 'src-valid',
    title: 'Valid',
    type: 'file',
    rawContent: '# Body',
    ingestedAt: Date.now(),
  });
  const ts = Date.now();
  db.prepare(
    `INSERT INTO concepts (id, title, summary, body, sources, related, created_at, updated_at, version)
     VALUES ('c-valid', 't', 's', 'b', '[]', '[]', ?, ?, 1)`,
  ).run(ts, ts);
  db.prepare(
    `INSERT INTO concepts (id, title, summary, body, sources, related, created_at, updated_at, version)
     VALUES ('c-valid-2', 't', 's', 'b', '[]', '[]', ?, ?, 1)`,
  ).run(ts, ts);
  db.prepare(
    `INSERT INTO source_chunks (id, source_id, chunk_index, heading, heading_path, content, token_count, content_hash, created_at, updated_at)
     VALUES ('chunk-valid', 'src-valid', 0, 'h', 'h', 'c', 1, 'hash', ?, ?)`,
  ).run(ts, ts);

  db.prepare(
    `INSERT INTO concept_evidence (id, concept_id, source_id, chunk_id, quote, claim, kind, confidence, created_at)
     VALUES ('ev-valid', 'c-valid', 'src-valid', 'chunk-valid', 'q', 'claim', 'support', 0.9, ?)`,
  ).run(ts);
  db.prepare(
    `INSERT INTO concept_evidence (id, concept_id, source_id, chunk_id, quote, claim, kind, confidence, created_at)
     VALUES ('ev-orphan', 'c-missing', 'src-missing', NULL, 'q', 'claim', 'support', 0.9, ?)`,
  ).run(ts);

  db.prepare(
    `INSERT INTO concept_relations (id, source_concept_id, target_concept_id, kind, reason, confidence, created_at, updated_at)
     VALUES ('rel-valid', 'c-valid', 'c-valid-2', 'related', 'r', 0.9, ?, ?)`,
  ).run(ts, ts);
  db.prepare(
    `INSERT INTO concept_relations (id, source_concept_id, target_concept_id, kind, reason, confidence, created_at, updated_at)
     VALUES ('rel-orphan', 'c-valid', 'c-missing', 'related', 'r', 0.9, ?, ?)`,
  ).run(ts, ts);

  const insertEmb = db.prepare(
    `INSERT INTO chunk_embeddings (chunk_id, source_id, model, provider, dimensions, vector_json, content_hash, created_at, updated_at)
     VALUES (?, ?, 'm', 'p', 1, '[0]', 'h', ?, ?)`,
  );
  insertEmb.run('chunk-valid', 'src-valid', ts, ts);
  insertEmb.run('chunk-missing', 'src-missing', ts, ts);

  const result = runRetention();

  assert.equal(result.orphanEvidenceDeleted, 1);
  assert.equal(result.orphanRelationsDeleted, 1);
  assert.equal(result.orphanChunkEmbeddingsDeleted, 1);

  const integrity = wikiRepo.getIntegrityCounts();
  assert.equal(integrity.orphanEvidence.count, 0);
  assert.equal(integrity.orphanRelations.count, 0);
  assert.equal(integrity.orphanChunkEmbeddings.count, 0);

  // Valid rows preserved.
  assert.ok(db.prepare(`SELECT id FROM concept_evidence WHERE id = 'ev-valid'`).get());
  assert.ok(db.prepare(`SELECT id FROM concept_relations WHERE id = 'rel-valid'`).get());
  assert.ok(
    db.prepare(`SELECT chunk_id FROM chunk_embeddings WHERE chunk_id = 'chunk-valid'`).get(),
  );
});

test('failJobPermanently deletes the github_ingest payload blob (no orphan blob)', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { queueGithubIngestJob, failJobPermanently } = await import('./analysis-worker');

  const jobId = queueGithubIngestJob({
    runId: 'run-blob-1',
    itemId: 'item-blob-1',
    repoSlug: 'owner/repo',
    branch: 'main',
    path: 'a.md',
    sha: 'sha1',
    externalKey: 'owner/repo:main:a.md',
    title: 'A',
    rawContent: '# hello world',
  });

  const db = getServerDb();
  const blobCount = () =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM analysis_payload_blobs`).get() as { c: number }).c,
    );
  assert.equal(blobCount(), 1);

  const ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w' WHERE id = ?`,
  ).run(ts, ts, jobId);
  const job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(jobId) as Parameters<
    typeof failJobPermanently
  >[0];

  assert.equal(failJobPermanently(job, 'permanent failure'), true);
  assert.equal(blobCount(), 0);
});

test('terminal failJob deletes the blob; a transient (non-terminal) failJob keeps it', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { getServerDb } = await import('./server-db');
  const { queueGithubIngestJob, failJob } = await import('./analysis-worker');
  const db = getServerDb();
  const blobCount = () =>
    Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM analysis_payload_blobs`).get() as { c: number }).c,
    );

  // Non-terminal: first attempt of a transient error keeps the blob (will retry).
  const transientId = queueGithubIngestJob({
    runId: 'run-blob-2',
    itemId: 'item-blob-2',
    repoSlug: 'owner/repo',
    branch: 'main',
    path: 'b.md',
    sha: 'sha2',
    externalKey: 'owner/repo:main:b.md',
    title: 'B',
    rawContent: '# body b',
  });
  let ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w', max_attempts = 3, attempts = 0 WHERE id = ?`,
  ).run(ts, ts, transientId);
  let job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(transientId) as Parameters<
    typeof failJob
  >[0];
  failJob(job, new Error('transient boom'));
  // queued again (not terminal) → blob retained for the retry.
  assert.equal(
    (
      db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(transientId) as {
        status: string;
      }
    ).status,
    'queued',
  );
  assert.equal(blobCount(), 1);

  // Terminal: exhaust attempts → failJob marks failed and removes the blob.
  ts = Date.now();
  db.prepare(
    `UPDATE analysis_jobs SET status = 'running', started_at = ?, locked_at = ?, locked_by = 'w', max_attempts = 1, attempts = 0 WHERE id = ?`,
  ).run(ts, ts, transientId);
  job = db.prepare(`SELECT * FROM analysis_jobs WHERE id = ?`).get(transientId) as Parameters<
    typeof failJob
  >[0];
  failJob(job, new Error('boom again'));
  assert.equal(
    (
      db.prepare(`SELECT status FROM analysis_jobs WHERE id = ?`).get(transientId) as {
        status: string;
      }
    ).status,
    'failed',
  );
  assert.equal(blobCount(), 0);
});

test('maybeRunRetention runs once then is throttled within the min interval', async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  const previousInterval = process.env.COMPOUND_RETENTION_MIN_INTERVAL_MS;
  process.env.COMPOUND_RETENTION_MIN_INTERVAL_MS = '600000';
  t.after(() => {
    if (previousInterval === undefined) delete process.env.COMPOUND_RETENTION_MIN_INTERVAL_MS;
    else process.env.COMPOUND_RETENTION_MIN_INTERVAL_MS = previousInterval;
  });

  const { maybeRunRetention } = await import('./retention');
  const first = maybeRunRetention();
  const second = maybeRunRetention();
  assert.ok(first, 'first call should run');
  assert.equal(second, null, 'second call within interval should be throttled');
});
