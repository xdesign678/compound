/**
 * Async analysis worker for Compound.
 *
 * This file upgrades `analysis_jobs` from a visibility marker into a real,
 * retryable queue. It intentionally uses SQLite only, so the project still runs
 * without Redis/BullMQ. The queue model is compatible with a future BullMQ swap:
 * queued -> running -> succeeded | failed | cancelled.
 */
import { nanoid } from 'nanoid';
import { getServerDb, repo } from './server-db';
import { ingestSourceToServerDb } from './server-ingest';
import { syncObs, ensureSyncObservabilitySchema } from './sync-observability';
import { embedSourceChunks } from './embedding';
import { createReviewItem } from './review-queue';
import { chat, parseJSON } from './gateway';

export type AdvancedAnalysisStage =
  | 'github_ingest'
  | 'chunk'
  | 'fts'
  | 'embedding'
  | 'summarize'
  | 'concepts'
  | 'relations'
  | 'qa_index';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

interface AnalysisJobRow {
  id: string;
  source_id: string;
  source_sha: string | null;
  source_path: string | null;
  stage: AdvancedAnalysisStage;
  stage_version: string;
  model: string | null;
  prompt_version: string | null;
  status: JobStatus;
  attempts: number;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
  run_id?: string | null;
  item_id?: string | null;
  payload_json?: string | null;
  priority?: number | null;
  not_before_at?: number | null;
  locked_at?: number | null;
  locked_by?: string | null;
  max_attempts?: number | null;
}

interface GithubIngestPayload {
  runId: string;
  itemId: string;
  legacyJobId?: string | null;
  repoSlug: string;
  branch: string;
  path: string;
  sha: string;
  externalKey: string;
  title: string;
  rawContent: string;
  replaceSourceId?: string | null;
}

const WORKER_ID = `worker-${nanoid(8)}`;
const DEFAULT_STAGE_VERSION = process.env.COMPOUND_ANALYSIS_STAGE_VERSION || 'v2';
const WORKER_BATCH = Math.max(1, Number(process.env.COMPOUND_ANALYSIS_WORKER_BATCH || 3));
const WORKER_MAX_LOOPS = Math.max(
  1,
  Number(process.env.COMPOUND_ANALYSIS_WORKER_MAX_LOOPS || 1000),
);

let schemaReady = false;

function now(): number {
  return Date.now();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function tableColumns(table: string): Set<string> {
  const rows = getServerDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return new Set(rows.map((row) => row.name));
}

function addColumnIfMissing(table: string, column: string, sql: string): void {
  const columns = tableColumns(table);
  if (!columns.has(column)) getServerDb().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql};`);
}

export function ensureAnalysisWorkerSchema(): void {
  if (schemaReady) return;
  ensureSyncObservabilitySchema();
  const db = getServerDb();

  addColumnIfMissing('analysis_jobs', 'run_id', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'item_id', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'payload_json', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'priority', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('analysis_jobs', 'not_before_at', 'INTEGER');
  addColumnIfMissing('analysis_jobs', 'locked_at', 'INTEGER');
  addColumnIfMissing('analysis_jobs', 'locked_by', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'max_attempts', 'INTEGER NOT NULL DEFAULT 3');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_queue
      ON analysis_jobs(status, not_before_at, priority, updated_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_run_item
      ON analysis_jobs(run_id, item_id, status);
    CREATE TABLE IF NOT EXISTS source_analysis (
      source_id TEXT PRIMARY KEY,
      source_sha TEXT,
      title TEXT,
      summary TEXT,
      topics TEXT NOT NULL DEFAULT '[]',
      entities TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      model TEXT,
      prompt_version TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_source_analysis_updated ON source_analysis(updated_at DESC);
  `);
  schemaReady = true;
}

function makeJobId(parts: Array<string | null | undefined>): string {
  const clean = parts.map((part) => part || '').join('\x1f');
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  return `aj-${hash.toString(16)}-${Math.abs(clean.length)}`;
}

export function queueAdvancedAnalysisJob(input: {
  runId?: string | null;
  itemId?: string | null;
  sourceId: string;
  sourceSha?: string | null;
  sourcePath?: string | null;
  stage: AdvancedAnalysisStage;
  stageVersion?: string;
  model?: string | null;
  promptVersion?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}): string {
  ensureAnalysisWorkerSchema();
  const id = makeJobId([
    input.runId,
    input.itemId,
    input.sourceId,
    input.sourceSha,
    input.sourcePath,
    input.stage,
    input.stageVersion || DEFAULT_STAGE_VERSION,
    input.model,
    input.promptVersion,
  ]);
  const ts = now();
  getServerDb()
    .prepare(
      `INSERT INTO analysis_jobs
        (id, source_id, source_sha, source_path, stage, stage_version, model, prompt_version,
         status, attempts, error, updated_at, run_id, item_id, payload_json, priority, not_before_at, max_attempts)
       VALUES
        (@id, @source_id, @source_sha, @source_path, @stage, @stage_version, @model, @prompt_version,
         'queued', 0, NULL, @updated_at, @run_id, @item_id, @payload_json, @priority, @not_before_at, @max_attempts)
       ON CONFLICT(id) DO UPDATE SET
         status = CASE WHEN analysis_jobs.status IN ('succeeded', 'running') THEN analysis_jobs.status ELSE 'queued' END,
         error = NULL,
         payload_json = excluded.payload_json,
         priority = excluded.priority,
         not_before_at = excluded.not_before_at,
         updated_at = excluded.updated_at`,
    )
    .run({
      id,
      source_id: input.sourceId,
      source_sha: input.sourceSha ?? null,
      source_path: input.sourcePath ?? null,
      stage: input.stage,
      stage_version: input.stageVersion || DEFAULT_STAGE_VERSION,
      model: input.model ?? null,
      prompt_version: input.promptVersion ?? null,
      updated_at: ts,
      run_id: input.runId ?? null,
      item_id: input.itemId ?? null,
      payload_json: input.payload ? JSON.stringify(input.payload) : null,
      priority: input.priority ?? 0,
      not_before_at: ts,
      max_attempts: input.maxAttempts ?? 3,
    });
  return id;
}

export function queueGithubIngestJob(payload: GithubIngestPayload): string {
  return queueAdvancedAnalysisJob({
    runId: payload.runId,
    itemId: payload.itemId,
    sourceId: `pending:${payload.repoSlug}:${payload.branch}:${payload.path}`,
    sourceSha: payload.sha,
    sourcePath: payload.path,
    stage: 'github_ingest',
    stageVersion: DEFAULT_STAGE_VERSION,
    payload: payload as unknown as Record<string, unknown>,
    priority: 100,
    maxAttempts: 3,
  });
}

function claimJobs(limit: number): AnalysisJobRow[] {
  ensureAnalysisWorkerSchema();
  const db = getServerDb();
  const rows = db
    .prepare(
      `SELECT * FROM analysis_jobs
       WHERE status = 'queued' AND COALESCE(not_before_at, 0) <= ?
       ORDER BY priority DESC, updated_at ASC
       LIMIT ?`,
    )
    .all(now(), limit) as AnalysisJobRow[];

  const claimed: AnalysisJobRow[] = [];
  const stmt = db.prepare(
    `UPDATE analysis_jobs
     SET status = 'running', locked_at = ?, locked_by = ?, started_at = COALESCE(started_at, ?), updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  );
  for (const row of rows) {
    const ts = now();
    const res = stmt.run(ts, WORKER_ID, ts, ts, row.id);
    if (res.changes > 0)
      claimed.push({ ...row, status: 'running', locked_at: ts, locked_by: WORKER_ID });
  }
  return claimed;
}

function finishJob(
  job: AnalysisJobRow,
  status: Extract<JobStatus, 'succeeded' | 'skipped' | 'cancelled'>,
  error?: string,
): void {
  const ts = now();
  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = ?, error = ?, finished_at = ?, updated_at = ?, locked_at = NULL, locked_by = NULL
       WHERE id = ?`,
    )
    .run(status, error ?? null, ts, ts, job.id);
}

function failJob(job: AnalysisJobRow, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = (job.attempts || 0) + 1;
  const maxAttempts = job.max_attempts || 3;
  const terminal = attempts >= maxAttempts;
  const delay = terminal
    ? null
    : Math.min(15 * 60_000, 1000 * 2 ** attempts + Math.floor(Math.random() * 500));
  const ts = now();

  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = ?, attempts = ?, error = ?, not_before_at = ?, updated_at = ?,
           finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
           locked_at = NULL, locked_by = NULL
       WHERE id = ?`,
    )
    .run(
      terminal ? 'failed' : 'queued',
      attempts,
      message.slice(0, 500),
      delay ? ts + delay : null,
      ts,
      terminal ? 1 : 0,
      ts,
      job.id,
    );

  syncObs.recordEvent({
    runId: job.run_id,
    itemId: job.item_id,
    level: terminal ? 'error' : 'warn',
    stage: job.stage,
    path: job.source_path,
    message: terminal
      ? `分析失败：${message.slice(0, 180)}`
      : `分析失败，稍后重试：${message.slice(0, 180)}`,
  });

  if (terminal && job.item_id && job.stage === 'github_ingest') {
    syncObs.updateRunItem(job.item_id, {
      status: 'failed',
      stage: 'llm',
      error: message.slice(0, 500),
      finished_at: ts,
    });
    incrementLegacy(job, 'failed');
    maybeFinishRun(job.run_id || null);
  }
}

function incrementLegacy(job: AnalysisJobRow, outcome: 'done' | 'failed'): void {
  const payload = parseJson<GithubIngestPayload>(job.payload_json, {} as GithubIngestPayload);
  const legacyJobId = payload.legacyJobId;
  if (!legacyJobId) return;
  const row = repo.getSyncJob(legacyJobId);
  if (!row || row.status !== 'running') return;
  repo.updateSyncJob(legacyJobId, {
    done: outcome === 'done' ? row.done + 1 : row.done,
    failed: outcome === 'failed' ? row.failed + 1 : row.failed,
    current: outcome === 'done' ? `已分析：${payload.path}` : `失败：${payload.path}`,
  });
}

function finalizeLegacyIfPossible(runId: string | null): void {
  if (!runId) return;
  const pending = getServerDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM sync_run_items
       WHERE run_id = ? AND status IN ('queued', 'running')`,
    )
    .get(runId) as { count: number };
  if (pending.count > 0) return;

  const anyFailed = getServerDb()
    .prepare(`SELECT COUNT(*) AS count FROM sync_run_items WHERE run_id = ? AND status = 'failed'`)
    .get(runId) as { count: number };
  const jobRows = getServerDb()
    .prepare(
      `SELECT payload_json FROM analysis_jobs WHERE run_id = ? AND payload_json IS NOT NULL LIMIT 1`,
    )
    .all(runId) as Array<{ payload_json: string }>;
  const legacyJobId = jobRows
    .map(
      (row) =>
        parseJson<GithubIngestPayload>(row.payload_json, {} as GithubIngestPayload).legacyJobId,
    )
    .find(Boolean);
  if (!legacyJobId) return;
  const row = repo.getSyncJob(legacyJobId);
  if (!row || row.status !== 'running') return;
  repo.updateSyncJob(legacyJobId, {
    status: anyFailed.count > 0 ? 'failed' : 'done',
    current: anyFailed.count > 0 ? '部分文件分析失败' : null,
    error: anyFailed.count > 0 ? '部分文件分析失败，请到 /sync 查看详情' : null,
    finished_at: now(),
  });
}

export function maybeFinishRun(runId: string | null): void {
  if (!runId) return;
  const db = getServerDb();
  const run = db.prepare(`SELECT * FROM sync_runs WHERE id = ?`).get(runId) as
    | { changed_files: number; status: string }
    | undefined;
  if (!run || run.status !== 'running') return;
  const stats = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status IN ('succeeded', 'skipped', 'cancelled') THEN 1 ELSE 0 END) AS doneCount,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedCount,
        COUNT(*) AS totalCount
       FROM sync_run_items WHERE run_id = ?`,
    )
    .get(runId) as { doneCount: number | null; failedCount: number | null; totalCount: number };
  const done = Number(stats.doneCount || 0);
  const failed = Number(stats.failedCount || 0);
  syncObs.updateRun(runId, {
    done_files: done,
    failed_files: failed,
    current: failed ? `${failed} 个文件失败` : null,
  });
  if (stats.totalCount > 0 && done + failed >= stats.totalCount) {
    syncObs.finishRun(runId, failed > 0 ? 'failed' : 'done', failed > 0 ? '部分文件失败' : null);
    finalizeLegacyIfPossible(runId);
  }
}

function queuePostIngestJobs(input: {
  runId: string;
  itemId: string;
  sourceId: string;
  sourceSha: string;
  sourcePath: string;
}): void {
  queueAdvancedAnalysisJob({
    runId: input.runId,
    itemId: input.itemId,
    sourceId: input.sourceId,
    sourceSha: input.sourceSha,
    sourcePath: input.sourcePath,
    stage: 'embedding',
    priority: 40,
    maxAttempts: 3,
  });
  queueAdvancedAnalysisJob({
    runId: input.runId,
    itemId: input.itemId,
    sourceId: input.sourceId,
    sourceSha: input.sourceSha,
    sourcePath: input.sourcePath,
    stage: 'summarize',
    model: process.env.LLM_MODEL || null,
    promptVersion: 'source-summary-v1',
    priority: 20,
    maxAttempts: 2,
  });
  queueAdvancedAnalysisJob({
    runId: input.runId,
    itemId: input.itemId,
    sourceId: input.sourceId,
    sourceSha: input.sourceSha,
    sourcePath: input.sourcePath,
    stage: 'qa_index',
    priority: 10,
    maxAttempts: 1,
  });
}

async function processGithubIngest(job: AnalysisJobRow): Promise<void> {
  const payload = parseJson<GithubIngestPayload>(job.payload_json, {} as GithubIngestPayload);
  if (!payload.rawContent || !payload.path || !payload.externalKey) {
    throw new Error('github_ingest payload is incomplete');
  }
  if (
    syncObs.getDashboard().activeRun?.id === payload.runId &&
    syncObs.getDashboard().activeRun?.status === 'cancelled'
  ) {
    finishJob(job, 'cancelled', 'run cancelled');
    return;
  }

  syncObs.updateRunItem(payload.itemId, {
    status: 'running',
    stage: 'llm',
    attempts: (job.attempts || 0) + 1,
    error: null,
    started_at: now(),
  });
  syncObs.recordEvent({
    runId: payload.runId,
    itemId: payload.itemId,
    stage: 'llm',
    path: payload.path,
    message: '开始 LLM 摄入与概念更新',
  });

  const result = await ingestSourceToServerDb({
    title: payload.title,
    type: 'file',
    rawContent: payload.rawContent,
    externalKey: payload.externalKey,
    replaceSourceId: payload.replaceSourceId ?? undefined,
  });

  const compiler = result.compiler;
  syncObs.markSourceFileActive({
    repo: payload.repoSlug,
    branch: payload.branch,
    path: payload.path,
    sourceId: result.sourceId,
    externalKey: payload.externalKey,
    blobSha: payload.sha,
    runId: payload.runId,
  });
  syncObs.updateRunItem(payload.itemId, {
    source_id: result.sourceId,
    status: 'succeeded',
    stage: 'complete',
    chunks: compiler?.chunks ?? null,
    concepts_created: result.newConceptIds.length,
    concepts_updated: result.updatedConceptIds.length,
    evidence: compiler?.evidence ?? null,
    error: null,
    finished_at: now(),
  });

  if (
    result.newConceptIds.length + result.updatedConceptIds.length >=
    Number(process.env.COMPOUND_REVIEW_LARGE_CHANGE_THRESHOLD || 8)
  ) {
    createReviewItem({
      kind: 'large_ingest_change',
      title: `大批量概念变更：${payload.path}`,
      targetType: 'source',
      targetId: result.sourceId,
      sourceId: result.sourceId,
      confidence: 0.55,
      payload: {
        path: payload.path,
        newConceptIds: result.newConceptIds,
        updatedConceptIds: result.updatedConceptIds,
      },
    });
  }

  incrementLegacy(job, 'done');
  syncObs.recordEvent({
    runId: payload.runId,
    itemId: payload.itemId,
    level: 'success',
    stage: 'complete',
    path: payload.path,
    message: `分析完成：新增 ${result.newConceptIds.length}，更新 ${result.updatedConceptIds.length}，分块 ${compiler?.chunks ?? 0}`,
  });
  queuePostIngestJobs({
    runId: payload.runId,
    itemId: payload.itemId,
    sourceId: result.sourceId,
    sourceSha: payload.sha,
    sourcePath: payload.path,
  });
  finishJob({ ...job, source_id: result.sourceId }, 'succeeded');
  maybeFinishRun(payload.runId);
}

async function processEmbedding(job: AnalysisJobRow): Promise<void> {
  const result = await embedSourceChunks(job.source_id);
  syncObs.recordEvent({
    runId: job.run_id,
    itemId: job.item_id,
    level: 'success',
    stage: 'embedding',
    path: job.source_path,
    message: `向量索引完成：${result.embedded} / ${result.total} chunks`,
  });
  finishJob(job, 'succeeded');
}

async function processSummarize(job: AnalysisJobRow): Promise<void> {
  if (process.env.COMPOUND_DISABLE_SOURCE_SUMMARY_WORKER === 'true') {
    finishJob(job, 'skipped', 'disabled by COMPOUND_DISABLE_SOURCE_SUMMARY_WORKER');
    return;
  }
  const source = repo.getSource(job.source_id);
  if (!source) {
    finishJob(job, 'skipped', 'source not found');
    return;
  }
  const prompt = `请把下面 Markdown 文档分析成严格 JSON，只输出 JSON。\n\nSchema: {"summary":"100字以内摘要","topics":["主题"],"entities":["实体"],"confidence":0.0}\n\n标题：${source.title}\n\n内容：\n${source.rawContent.slice(0, 12000)}`;
  const raw = await chat({
    messages: [
      { role: 'system', content: '你是知识库文档分析器。只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ],
    responseFormat: 'json_object',
    temperature: 0.2,
    maxTokens: 900,
    task: 'source_summarize',
  });
  const parsed = parseJSON<{
    summary?: string;
    topics?: string[];
    entities?: string[];
    confidence?: number;
  }>(raw);
  const confidence =
    typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7;
  getServerDb()
    .prepare(
      `INSERT OR REPLACE INTO source_analysis
        (source_id, source_sha, title, summary, topics, entities, confidence, model, prompt_version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source.id,
      job.source_sha,
      source.title,
      parsed.summary || '',
      JSON.stringify(Array.isArray(parsed.topics) ? parsed.topics.slice(0, 12) : []),
      JSON.stringify(Array.isArray(parsed.entities) ? parsed.entities.slice(0, 24) : []),
      confidence,
      process.env.LLM_MODEL || null,
      'source-summary-v1',
      now(),
    );

  if (confidence < Number(process.env.COMPOUND_REVIEW_CONFIDENCE_THRESHOLD || 0.62)) {
    createReviewItem({
      kind: 'low_confidence_summary',
      title: `低置信度文档分析：${source.title}`,
      targetType: 'source',
      targetId: source.id,
      sourceId: source.id,
      confidence,
      payload: parsed,
    });
  }
  finishJob(job, 'succeeded');
}

async function processQaIndex(job: AnalysisJobRow): Promise<void> {
  // `ingestSourceToServerDb` already runs chunk + FTS + evidence compilation.
  // This stage is a cheap health marker so dashboards can distinguish "source
  // ingested" from "ready for retrieval".
  finishJob(job, 'succeeded');
}

async function processJob(job: AnalysisJobRow): Promise<void> {
  try {
    if (job.stage === 'github_ingest') await processGithubIngest(job);
    else if (job.stage === 'embedding') await processEmbedding(job);
    else if (job.stage === 'summarize') await processSummarize(job);
    else if (
      job.stage === 'qa_index' ||
      job.stage === 'chunk' ||
      job.stage === 'fts' ||
      job.stage === 'concepts' ||
      job.stage === 'relations'
    ) {
      await processQaIndex(job);
    } else {
      finishJob(job, 'skipped', `unknown stage: ${job.stage}`);
    }
  } catch (err) {
    failJob(job, err);
  }
}

export async function runAnalysisWorkerOnce(): Promise<{ claimed: number; remaining: number }> {
  ensureAnalysisWorkerSchema();
  const jobs = claimJobs(WORKER_BATCH);
  await Promise.all(jobs.map((job) => processJob(job)));
  const remaining = Number(
    (
      getServerDb()
        .prepare(`SELECT COUNT(*) AS count FROM analysis_jobs WHERE status = 'queued'`)
        .get() as { count: number }
    ).count || 0,
  );
  return { claimed: jobs.length, remaining };
}

export function startAnalysisWorker(reason = 'manual'): void {
  const g = globalThis as unknown as { __compoundAnalysisWorker?: Promise<void> };
  if (g.__compoundAnalysisWorker) return;

  g.__compoundAnalysisWorker = (async () => {
    syncObs.recordEvent({ stage: 'llm', message: `分析 worker 启动：${reason}` });
    try {
      for (let i = 0; i < WORKER_MAX_LOOPS; i += 1) {
        const result = await runAnalysisWorkerOnce();
        if (result.claimed === 0) break;
      }
    } finally {
      g.__compoundAnalysisWorker = undefined;
      syncObs.recordEvent({ stage: 'llm', level: 'success', message: '分析 worker 空闲' });
    }
  })();
}

export function retryAnalysisJobs(
  input: { runId?: string | null; itemId?: string | null; failedOnly?: boolean } = {},
): number {
  ensureAnalysisWorkerSchema();
  const clauses = [`status IN ('failed', 'cancelled')`];
  const params: unknown[] = [];
  if (input.runId) {
    clauses.push(`run_id = ?`);
    params.push(input.runId);
  }
  if (input.itemId) {
    clauses.push(`item_id = ?`);
    params.push(input.itemId);
  }
  const res = getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = 'queued', attempts = 0, error = NULL, not_before_at = ?, finished_at = NULL, updated_at = ?
       WHERE ${clauses.join(' AND ')}`,
    )
    .run(now(), now(), ...params);
  startAnalysisWorker('retry');
  return res.changes;
}

export function cancelAnalysisJobs(
  input: { runId?: string | null; itemId?: string | null } = {},
): number {
  ensureAnalysisWorkerSchema();
  const clauses = [`status IN ('queued', 'running')`];
  const params: unknown[] = [];
  if (input.runId) {
    clauses.push(`run_id = ?`);
    params.push(input.runId);
  }
  if (input.itemId) {
    clauses.push(`item_id = ?`);
    params.push(input.itemId);
  }
  const res = getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = 'cancelled', error = 'cancelled by user', finished_at = ?, updated_at = ?, locked_at = NULL, locked_by = NULL
       WHERE ${clauses.join(' AND ')}`,
    )
    .run(now(), now(), ...params);
  return res.changes;
}
