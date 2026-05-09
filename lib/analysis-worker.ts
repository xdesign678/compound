/**
 * Async analysis worker for Compound.
 *
 * This file upgrades `analysis_jobs` from a visibility marker into a real,
 * retryable queue. It intentionally uses SQLite only, so the project still runs
 * without Redis/BullMQ. The queue model is compatible with a future BullMQ swap:
 * queued -> running -> succeeded | failed | cancelled.
 */
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { getServerDb, repo } from './server-db';
import { ingestSourceToServerDb } from './server-ingest';
import { syncObs, ensureSyncObservabilitySchema } from './sync-observability';
import { embedSourceChunks } from './embedding';
import { createReviewItem } from './review-queue';
import { chat, parseJSON } from './gateway';
import {
  RELATION_EXTRACT_SYSTEM_PROMPT,
  RELATION_EXTRACT_SYSTEM_PROMPT_VERSION,
  SOURCE_SUMMARY_SYSTEM_PROMPT,
  SOURCE_SUMMARY_SYSTEM_PROMPT_VERSION,
} from './prompts';
import { now, parseJson } from './utils';
import { wikiRepo, type ConceptRelationKind } from './wiki-db';
import { getLlmBudgetStats, runWithLlmBudget, type LlmBudgetName } from './llm-budgets';

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
  input_hash?: string | null;
  output_hash?: string | null;
  duration_ms?: number | null;
  error_category?: string | null;
  heartbeat_at?: number | null;
  dead_letter_at?: number | null;
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
  rawContent?: string;
  rawContentRef?: string;
  rawContentHash?: string;
  replaceSourceId?: string | null;
}

const WORKER_ID = `worker-${nanoid(8)}`;
const DEFAULT_STAGE_VERSION = process.env.COMPOUND_ANALYSIS_STAGE_VERSION || 'v2';
const WORKER_BATCH = Math.max(1, Number(process.env.COMPOUND_ANALYSIS_WORKER_BATCH || 1));
const WORKER_MAX_LOOPS = Math.max(
  1,
  Number(process.env.COMPOUND_ANALYSIS_WORKER_MAX_LOOPS || 1000),
);
/**
 * Lease window: a job that's been `running` longer than this without any
 * heartbeat is assumed orphaned (server crashed / restarted / OOM'd) and gets
 * pushed back into the queue. Worker invocations fail fast on hung fetches via
 * `AbortSignal.timeout(LLM_TIMEOUT_MS)` inside the gateway (default 180s,
 * +60s for reasoning models), so the lease floor must comfortably exceed
 * that. 5 minutes is a safe ceiling.
 */
const LEASE_MS = Math.max(60_000, Number(process.env.COMPOUND_ANALYSIS_LEASE_MS || 5 * 60_000));
/** Max concurrent worker loops. We use DB lease + in-memory counter combined. */
const MAX_PARALLEL_WORKERS = Math.max(1, Number(process.env.COMPOUND_ANALYSIS_MAX_WORKERS || 2));
const HEARTBEAT_MS = Math.max(5_000, Number(process.env.COMPOUND_ANALYSIS_HEARTBEAT_MS || 15_000));
const MARKDOWN_PARSER_VERSION = process.env.COMPOUND_MARKDOWN_PARSER_VERSION || 'wiki-chunk-v1';
const RELATION_CONFIDENCE_AUTO_APPLY = Math.max(
  0,
  Math.min(1, Number(process.env.COMPOUND_RELATION_AUTO_APPLY_CONFIDENCE || 0.72)),
);
const MAX_RELATION_CONCEPTS = Math.max(
  2,
  Math.min(48, Number(process.env.COMPOUND_RELATION_MAX_CONCEPTS || 24)),
);
const RELATION_KINDS = new Set<ConceptRelationKind>([
  'supports',
  'extends',
  'depends_on',
  'example_of',
  'similar_to',
  'related',
  'contradicts',
  'same_as',
]);

let schemaReady = false;
let schemaDb: ReturnType<typeof getServerDb> | null = null;
let activeWorkerCount = 0;
const cancelControllers = new Map<string, AbortController>();

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
  ensureSyncObservabilitySchema();
  const db = getServerDb();
  if (schemaReady && schemaDb === db) return;

  addColumnIfMissing('analysis_jobs', 'run_id', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'item_id', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'payload_json', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'priority', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('analysis_jobs', 'not_before_at', 'INTEGER');
  addColumnIfMissing('analysis_jobs', 'locked_at', 'INTEGER');
  addColumnIfMissing('analysis_jobs', 'locked_by', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'max_attempts', 'INTEGER NOT NULL DEFAULT 3');
  addColumnIfMissing('analysis_jobs', 'input_hash', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'output_hash', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'duration_ms', 'INTEGER');
  addColumnIfMissing('analysis_jobs', 'error_category', 'TEXT');
  addColumnIfMissing('analysis_jobs', 'heartbeat_at', 'INTEGER');
  addColumnIfMissing('analysis_jobs', 'dead_letter_at', 'INTEGER');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_queue
      ON analysis_jobs(status, not_before_at, priority, updated_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_run_item
      ON analysis_jobs(run_id, item_id, status);
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_dlq
      ON analysis_jobs(dead_letter_at DESC)
      WHERE dead_letter_at IS NOT NULL;
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
    CREATE TABLE IF NOT EXISTS source_analysis_stage_cache (
      source_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      stage_version TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      prompt_version TEXT NOT NULL DEFAULT '',
      input_hash TEXT NOT NULL,
      output_hash TEXT,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(source_id, stage, stage_version, model, prompt_version, input_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_source_analysis_stage_cache_source
      ON source_analysis_stage_cache(source_id, stage, updated_at DESC);
    CREATE TABLE IF NOT EXISTS analysis_payload_blobs (
      ref TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );
  `);
  schemaReady = true;
  schemaDb = db;
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
  const stageVersion = input.stageVersion || DEFAULT_STAGE_VERSION;
  const model = input.model ?? '';
  const promptVersion = input.promptVersion ?? '';
  const sourceSha = input.sourceSha ?? '';
  const id = makeJobId([
    input.sourceId,
    sourceSha,
    input.stage,
    stageVersion,
    model,
    promptVersion,
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
       ON CONFLICT(source_id, source_sha, stage, stage_version, model, prompt_version) DO UPDATE SET
         status = CASE WHEN analysis_jobs.status = 'running' THEN analysis_jobs.status ELSE 'queued' END,
         error = NULL,
         dead_letter_at = NULL,
         run_id = excluded.run_id,
         item_id = excluded.item_id,
         source_path = excluded.source_path,
         payload_json = excluded.payload_json,
         priority = excluded.priority,
         not_before_at = excluded.not_before_at,
         updated_at = excluded.updated_at`,
    )
    .run({
      id,
      source_id: input.sourceId,
      source_sha: sourceSha,
      source_path: input.sourcePath ?? null,
      stage: input.stage,
      stage_version: stageVersion,
      model,
      prompt_version: promptVersion,
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
  ensureAnalysisWorkerSchema();
  const rawContent = payload.rawContent ?? '';
  const rawContentHash = payload.rawContentHash ?? stableHash(normalizeContentForHash(rawContent));
  const rawContentRef =
    payload.rawContentRef ??
    `github:${payload.repoSlug}:${payload.branch}:${payload.path}@${payload.sha}:${rawContentHash.slice(0, 16)}`;
  const compactPayload: GithubIngestPayload = {
    ...payload,
    rawContent: undefined,
    rawContentRef,
    rawContentHash,
  };
  if (typeof payload.rawContent === 'string') {
    const ts = now();
    getServerDb()
      .prepare(
        `INSERT INTO analysis_payload_blobs (ref, content, content_hash, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET
           content = excluded.content,
           content_hash = excluded.content_hash,
           last_used_at = excluded.last_used_at`,
      )
      .run(rawContentRef, rawContent, rawContentHash, ts, ts);
  }
  return queueAdvancedAnalysisJob({
    runId: payload.runId,
    itemId: payload.itemId,
    sourceId: `pending:${payload.repoSlug}:${payload.branch}:${payload.path}`,
    sourceSha: payload.sha,
    sourcePath: payload.path,
    stage: 'github_ingest',
    stageVersion: DEFAULT_STAGE_VERSION,
    payload: compactPayload as unknown as Record<string, unknown>,
    priority: 100,
    maxAttempts: 3,
  });
}

/**
 * Reset jobs that have been `running` past their lease window. These are
 * orphaned by a crashed worker / process restart. Returning them to `queued`
 * lets the next worker iteration pick them up automatically.
 *
 * Also nudges any `sync_run_items` whose `updated_at` heartbeat went stale —
 * UI shows "已停滞" without us having to wait for the LLM call to throw.
 */
export function recoverStaleAnalysisJobs(): { jobs: number; items: number } {
  ensureAnalysisWorkerSchema();
  const ts = now();
  const cutoff = ts - LEASE_MS;
  const db = getServerDb();
  const jobsRes = db
    .prepare(
      `UPDATE analysis_jobs
         SET status = 'queued',
             locked_at = NULL,
             locked_by = NULL,
             attempts = COALESCE(attempts, 0) + 1,
             error = COALESCE(error, 'lease expired (worker crashed)'),
             not_before_at = ?,
             updated_at = ?
       WHERE status = 'running' AND COALESCE(locked_at, started_at, updated_at) < ?`,
    )
    .run(ts, ts, cutoff);
  const itemsRes = db
    .prepare(
      `UPDATE sync_run_items
         SET status = 'queued',
             stage = 'queued',
             error = COALESCE(error, 'lease expired (worker crashed)'),
             updated_at = ?
       WHERE status = 'running' AND updated_at < ?`,
    )
    .run(ts, cutoff);
  if (Number(jobsRes.changes) > 0 || Number(itemsRes.changes) > 0) {
    syncObs.recordEvent({
      level: 'warn',
      stage: 'llm',
      message: `自动回收孤儿任务：analysis_jobs ${jobsRes.changes} · sync_run_items ${itemsRes.changes}`,
      meta: {
        event: 'sync.lease_recovered',
        jobs: Number(jobsRes.changes ?? 0),
        items: Number(itemsRes.changes ?? 0),
      },
    });
  }
  return { jobs: Number(jobsRes.changes ?? 0), items: Number(itemsRes.changes ?? 0) };
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
     SET status = 'running', locked_at = ?, locked_by = ?, started_at = COALESCE(started_at, ?), updated_at = ?, heartbeat_at = ?
     WHERE id = ? AND status = 'queued'`,
  );
  for (const row of rows) {
    const ts = now();
    const res = stmt.run(ts, WORKER_ID, ts, ts, ts, row.id);
    if (res.changes > 0)
      claimed.push({
        ...row,
        status: 'running',
        locked_at: ts,
        locked_by: WORKER_ID,
        started_at: row.started_at ?? ts,
        heartbeat_at: ts,
        updated_at: ts,
      });
  }
  return claimed;
}

function stableHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeContentForHash(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

function classifyJobError(err: unknown): string {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const lower = text.toLowerCase();
  if (/abort|cancel/.test(lower)) return 'cancelled';
  if (/timeout|timed out|econnreset|network|fetch failed/.test(lower)) return 'transient';
  if (/\b(429|408|5\d\d)\b|rate limit/.test(lower)) return 'transient';
  if (/not set|invalid api url|missing|缺少|schema/.test(lower)) return 'permanent';
  return 'unknown';
}

function currentRunSignal(runId: string | null | undefined): AbortSignal | undefined {
  if (!runId) return undefined;
  let ctrl = cancelControllers.get(runId);
  if (!ctrl) {
    ctrl = new AbortController();
    cancelControllers.set(runId, ctrl);
  }
  return ctrl.signal;
}

function refreshJobHeartbeat(job: AnalysisJobRow): void {
  const ts = now();
  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
          SET heartbeat_at = ?, locked_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running'`,
    )
    .run(ts, ts, ts, job.id);
  if (job.item_id) {
    syncObs.updateRunItem(job.item_id, {
      status: 'running',
      stage: job.stage === 'github_ingest' ? 'llm' : 'enhance',
    });
  }
  if (job.run_id) syncObs.updateRun(job.run_id, { stage: 'llm', current: job.source_path });
}

async function withJobHeartbeat<T>(job: AnalysisJobRow, fn: () => Promise<T>): Promise<T> {
  refreshJobHeartbeat(job);
  const timer = setInterval(() => refreshJobHeartbeat(job), HEARTBEAT_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

async function withBackgroundLlmBudget<T>(
  bucket: LlmBudgetName,
  job: AnalysisJobRow,
  fn: () => Promise<T>,
): Promise<T> {
  const stats = getLlmBudgetStats(bucket);
  if (stats.active >= stats.concurrency || stats.pending > 0 || stats.pausedUntil) {
    syncObs.recordEvent({
      runId: job.run_id,
      itemId: job.item_id,
      stage: job.stage,
      path: job.source_path,
      message: `等待后台 LLM 队列：${bucket} active=${stats.active}/${stats.concurrency} pending=${stats.pending}`,
      meta: {
        event: 'analysis.llm_budget_wait',
        bucket,
        active: stats.active,
        pending: stats.pending,
        concurrency: stats.concurrency,
        pausedUntil: stats.pausedUntil,
      },
    });
  }
  return runWithLlmBudget(bucket, fn, { signal: currentRunSignal(job.run_id) });
}

function computeStageInputHash(job: AnalysisJobRow): string | null {
  if (job.stage === 'github_ingest') {
    const payload = parseJson<GithubIngestPayload>(job.payload_json, {} as GithubIngestPayload);
    const rawContent = getGithubIngestRawContent(payload);
    if (typeof rawContent !== 'string') return null;
    const contentHash = payload.rawContentHash ?? stableHash(normalizeContentForHash(rawContent));
    return stableHash(
      [
        payload.repoSlug,
        payload.branch,
        payload.path,
        payload.sha,
        contentHash,
        MARKDOWN_PARSER_VERSION,
        job.stage_version,
        job.prompt_version ?? '',
        job.model ?? '',
      ].join('\x1f'),
    );
  }
  const source = repo.getSource(job.source_id);
  if (!source) return null;
  return stableHash(
    [
      source.externalKey ?? '',
      job.source_path ?? '',
      job.source_sha ?? '',
      stableHash(normalizeContentForHash(source.rawContent)),
      MARKDOWN_PARSER_VERSION,
      job.stage,
      job.stage_version,
      job.prompt_version ?? '',
      job.model ?? '',
    ].join('\x1f'),
  );
}

function getCachedStageStatus(job: AnalysisJobRow, inputHash: string | null): string | null {
  if (!inputHash || job.stage === 'github_ingest') return null;
  const row = getServerDb()
    .prepare(
      `SELECT status FROM source_analysis_stage_cache
        WHERE source_id = ?
          AND stage = ?
          AND stage_version = ?
          AND model = ?
          AND prompt_version = ?
          AND input_hash = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .get(
      job.source_id,
      job.stage,
      job.stage_version,
      job.model ?? '',
      job.prompt_version ?? '',
      inputHash,
    ) as { status?: string } | undefined;
  return row?.status ?? null;
}

function getGithubIngestRawContent(payload: GithubIngestPayload): string | null {
  if (typeof payload.rawContent === 'string') return payload.rawContent;
  if (!payload.rawContentRef) return null;
  const row = getServerDb()
    .prepare(`SELECT content FROM analysis_payload_blobs WHERE ref = ?`)
    .get(payload.rawContentRef) as { content?: string } | undefined;
  if (typeof row?.content !== 'string') return null;
  getServerDb()
    .prepare(`UPDATE analysis_payload_blobs SET last_used_at = ? WHERE ref = ?`)
    .run(now(), payload.rawContentRef);
  return row.content;
}

async function resolveGithubIngestRawContent(payload: GithubIngestPayload): Promise<string | null> {
  const cached = getGithubIngestRawContent(payload);
  if (cached != null) return cached;
  if (!payload.path || !payload.sha) return null;

  try {
    const { fetchMarkdownContent, getGithubConfig } = await import('./github-sync');
    const cfg = getGithubConfig();
    const remote = await fetchMarkdownContent(payload.path, cfg, payload.sha);
    const rawContentHash = stableHash(normalizeContentForHash(remote.content));
    const rawContentRef =
      payload.rawContentRef ??
      `github:${payload.repoSlug}:${payload.branch}:${payload.path}@${payload.sha}:${rawContentHash.slice(0, 16)}`;
    const ts = now();
    getServerDb()
      .prepare(
        `INSERT INTO analysis_payload_blobs (ref, content, content_hash, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET
           content = excluded.content,
           content_hash = excluded.content_hash,
           last_used_at = excluded.last_used_at`,
      )
      .run(rawContentRef, remote.content, rawContentHash, ts, ts);
    return remote.content;
  } catch {
    return null;
  }
}

function recordStageCache(
  job: AnalysisJobRow,
  status: Extract<JobStatus, 'succeeded' | 'skipped' | 'cancelled'>,
  error?: string,
): void {
  const inputHash = computeStageInputHash(job);
  if (!inputHash || status === 'cancelled') return;
  const ts = now();
  const outputHash = stableHash(`${status}\x1f${error ?? ''}\x1f${ts}`);
  getServerDb()
    .prepare(
      `INSERT OR REPLACE INTO source_analysis_stage_cache
        (source_id, stage, stage_version, model, prompt_version, input_hash, output_hash, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.source_id,
      job.stage,
      job.stage_version,
      job.model ?? '',
      job.prompt_version ?? '',
      inputHash,
      outputHash,
      status,
      ts,
    );
  getServerDb()
    .prepare(`UPDATE analysis_jobs SET input_hash = ?, output_hash = ? WHERE id = ?`)
    .run(inputHash, outputHash, job.id);
}

function maybeFinalizeItemAfterStage(job: AnalysisJobRow): void {
  if (!job.item_id || job.stage === 'github_ingest') return;
  const db = getServerDb();
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS count FROM analysis_jobs
        WHERE item_id = ?
          AND stage != 'github_ingest'
          AND status IN ('queued', 'running')`,
    )
    .get(job.item_id) as { count: number };
  if (Number(pending.count || 0) > 0) return;

  const failed = db
    .prepare(
      `SELECT COUNT(*) AS count FROM analysis_jobs
        WHERE item_id = ?
          AND stage != 'github_ingest'
          AND status = 'failed'`,
    )
    .get(job.item_id) as { count: number };
  const terminal = db
    .prepare(
      `SELECT COUNT(*) AS count FROM analysis_jobs
        WHERE item_id = ?
          AND stage != 'github_ingest'
          AND status IN ('succeeded', 'skipped', 'failed', 'cancelled')`,
    )
    .get(job.item_id) as { count: number };
  if (Number(terminal.count || 0) === 0) return;

  const failedCount = Number(failed.count || 0);
  syncObs.updateRunItem(job.item_id, {
    status: failedCount > 0 ? 'failed' : 'succeeded',
    stage: 'complete',
    error: failedCount > 0 ? `${failedCount} 个增强分析阶段失败` : null,
    finished_at: now(),
  });
  maybeFinishRun(job.run_id || null);
}

function finishJob(
  job: AnalysisJobRow,
  status: Extract<JobStatus, 'succeeded' | 'skipped' | 'cancelled'>,
  error?: string,
): void {
  const ts = now();
  const durationMs = job.started_at ? Math.max(0, ts - job.started_at) : null;
  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = ?, error = ?, finished_at = ?, updated_at = ?, duration_ms = COALESCE(duration_ms, ?),
           locked_at = NULL, locked_by = NULL
       WHERE id = ?`,
    )
    .run(status, error ?? null, ts, ts, durationMs, job.id);
  recordStageCache(job, status, error);
  maybeFinalizeItemAfterStage(job);
}

function failJob(job: AnalysisJobRow, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const category = classifyJobError(err);
  const attempts = (job.attempts || 0) + 1;
  const maxAttempts = job.max_attempts || 3;
  const terminal = category === 'permanent' || attempts >= maxAttempts;
  const delay = terminal
    ? null
    : Math.min(15 * 60_000, 1000 * 2 ** attempts + Math.floor(Math.random() * 500));
  const ts = now();
  const durationMs = job.started_at ? Math.max(0, ts - job.started_at) : null;

  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = ?, attempts = ?, error = ?, error_category = ?, not_before_at = ?, updated_at = ?,
           finished_at = CASE WHEN ? THEN ? ELSE finished_at END,
           duration_ms = CASE WHEN ? THEN ? ELSE duration_ms END,
           dead_letter_at = CASE WHEN ? THEN ? ELSE NULL END,
           locked_at = NULL, locked_by = NULL
       WHERE id = ?`,
    )
    .run(
      terminal ? 'failed' : 'queued',
      attempts,
      message.slice(0, 500),
      category,
      delay ? ts + delay : null,
      ts,
      terminal ? 1 : 0,
      ts,
      terminal ? 1 : 0,
      durationMs,
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
  } else if (terminal) {
    maybeFinalizeItemAfterStage(job);
  }
}

function failJobPermanently(job: AnalysisJobRow, message: string): void {
  const ts = now();
  const attempts = job.max_attempts || 1;
  const durationMs = job.started_at ? Math.max(0, ts - job.started_at) : null;
  getServerDb()
    .prepare(
      `UPDATE analysis_jobs
       SET status = 'failed',
           attempts = ?,
           error = ?,
           error_category = 'permanent',
           not_before_at = NULL,
           finished_at = ?,
           updated_at = ?,
           duration_ms = ?,
           dead_letter_at = ?,
           locked_at = NULL,
           locked_by = NULL
       WHERE id = ?`,
    )
    .run(attempts, message.slice(0, 500), ts, ts, durationMs, ts, job.id);

  syncObs.recordEvent({
    runId: job.run_id,
    itemId: job.item_id,
    level: 'error',
    stage: job.stage,
    path: job.source_path,
    message: message.slice(0, 180),
  });
  maybeFinalizeItemAfterStage(job);
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
    promptVersion: SOURCE_SUMMARY_SYSTEM_PROMPT_VERSION,
    priority: 20,
    maxAttempts: 2,
  });
  queueAdvancedAnalysisJob({
    runId: input.runId,
    itemId: input.itemId,
    sourceId: input.sourceId,
    sourceSha: input.sourceSha,
    sourcePath: input.sourcePath,
    stage: 'relations',
    model: process.env.LLM_MODEL || null,
    promptVersion: RELATION_EXTRACT_SYSTEM_PROMPT_VERSION,
    priority: 15,
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
  const rawContent = await resolveGithubIngestRawContent(payload);
  if (typeof rawContent !== 'string' || !payload.path || !payload.externalKey) {
    const message = 'GitHub 分析任务缺少文件内容，请重新同步该文件。';
    failJobPermanently(job, message);
    if (job.item_id) {
      syncObs.updateRunItem(job.item_id, {
        status: 'failed',
        stage: 'llm',
        error: message,
        finished_at: now(),
      });
    }
    incrementLegacy(job, 'failed');
    maybeFinishRun(job.run_id || null);
    return;
  }
  if (rawContent.trim().length === 0) {
    finishJob(job, 'skipped', 'empty markdown file');
    if (payload.itemId) {
      syncObs.updateRunItem(payload.itemId, {
        status: 'skipped',
        stage: 'complete',
        finished_at: now(),
        error: '空 Markdown 文件，已跳过分析',
      });
    }
    incrementLegacy(job, 'done');
    maybeFinishRun(payload.runId);
    return;
  }
  if (isRunCancelled(payload.runId)) {
    finishJob(job, 'cancelled', 'run cancelled');
    if (payload.itemId) {
      syncObs.updateRunItem(payload.itemId, {
        status: 'cancelled',
        stage: 'complete',
        finished_at: now(),
        error: 'run cancelled',
      });
    }
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
    rawContent,
    externalKey: payload.externalKey,
    replaceSourceId: payload.replaceSourceId ?? undefined,
    signal: currentRunSignal(payload.runId),
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
    status: 'running',
    stage: 'enhance',
    chunks: compiler?.chunks ?? null,
    concepts_created: result.newConceptIds.length,
    concepts_updated: result.updatedConceptIds.length,
    evidence: compiler?.evidence ?? null,
    error: null,
    finished_at: null,
  });

  if (
    result.newConceptIds.length + result.updatedConceptIds.length >
    Number(process.env.COMPOUND_REVIEW_LARGE_CHANGE_THRESHOLD || 15)
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
    stage: 'enhance',
    path: payload.path,
    message: `基础入库完成，增强分析已排队：新增 ${result.newConceptIds.length}，更新 ${result.updatedConceptIds.length}，分块 ${compiler?.chunks ?? 0}`,
  });
  queuePostIngestJobs({
    runId: payload.runId,
    itemId: payload.itemId,
    sourceId: result.sourceId,
    sourceSha: payload.sha,
    sourcePath: payload.path,
  });
  finishJob({ ...job, source_id: result.sourceId }, 'succeeded');
}

async function processEmbedding(job: AnalysisJobRow): Promise<void> {
  const result = await embedSourceChunks(job.source_id, { signal: currentRunSignal(job.run_id) });
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
      { role: 'system', content: SOURCE_SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    responseFormat: 'json_object',
    temperature: 0.2,
    maxTokens: 900,
    task: 'source_summarize',
    promptVersion: job.prompt_version ?? SOURCE_SUMMARY_SYSTEM_PROMPT_VERSION,
    signal: currentRunSignal(job.run_id),
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
      job.prompt_version ?? SOURCE_SUMMARY_SYSTEM_PROMPT_VERSION,
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

interface RelationLLMSuggestion {
  sourceConceptId?: string;
  targetConceptId?: string;
  kind?: string;
  reason?: string;
  confidence?: number;
}

function normalizeWorkerRelationKind(kind: unknown): ConceptRelationKind {
  return RELATION_KINDS.has(kind as ConceptRelationKind)
    ? (kind as ConceptRelationKind)
    : 'related';
}

function hasConfiguredServerLlm(): boolean {
  return Boolean(
    (process.env.LLM_API_KEY || '').trim() || (process.env.AI_GATEWAY_API_KEY || '').trim(),
  );
}

function buildRelationConceptBlock(
  concepts: Array<{ id: string; title: string; summary: string; body: string }>,
): string {
  return concepts
    .map((concept) => {
      const body = concept.body.trim().slice(0, 700);
      return `- [${concept.id}] ${concept.title}\n  摘要: ${concept.summary}\n  正文摘录: ${body || '(无正文)'}`;
    })
    .join('\n\n');
}

async function processRelations(job: AnalysisJobRow): Promise<void> {
  const source = repo.getSource(job.source_id);
  if (!source) {
    finishJob(job, 'skipped', 'source not found');
    return;
  }

  const sourceConcepts = repo
    .listConcepts({ summariesOnly: false })
    .filter((concept) => concept.sources.includes(source.id))
    .slice(0, MAX_RELATION_CONCEPTS);

  const synced = wikiRepo.syncRelatedConceptRelations(sourceConcepts, {
    reason: `资料「${source.title}」关系抽取前同步。`,
    confidence: 0.68,
  });

  if (sourceConcepts.length < 2) {
    syncObs.recordEvent({
      runId: job.run_id,
      itemId: job.item_id,
      level: 'success',
      stage: 'relations',
      path: job.source_path,
      message: `关系同步完成：legacy related ${synced} 条，概念不足 2 个，跳过 LLM 抽取`,
    });
    finishJob(job, 'succeeded');
    return;
  }

  if (process.env.COMPOUND_DISABLE_RELATION_WORKER === 'true' || !hasConfiguredServerLlm()) {
    syncObs.recordEvent({
      runId: job.run_id,
      itemId: job.item_id,
      level: 'success',
      stage: 'relations',
      path: job.source_path,
      message: `关系同步完成：legacy related ${synced} 条，LLM 关系抽取未启用`,
    });
    finishJob(job, 'succeeded');
    return;
  }

  const prompt = `请从下面同一资料生成的概念页中抽取概念关系，只输出严格 JSON。\n\nSchema: {"relations":[{"sourceConceptId":"c-...","targetConceptId":"c-...","kind":"supports|extends|depends_on|example_of|similar_to|related|contradicts|same_as","reason":"一句话说明证据","confidence":0.0}]}\n\n规则：\n- 只使用列表中存在的 concept id。\n- 不要输出自环。\n- 有明确方向时保留方向，例如 A depends_on B。\n- 没有明确语义但确实相关时才使用 related。\n- confidence 低于 0.55 的不要输出。\n\n资料标题：${source.title}\n\n概念列表：\n${buildRelationConceptBlock(sourceConcepts)}`;

  const raw = await chat({
    messages: [
      { role: 'system', content: RELATION_EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    responseFormat: 'json_object',
    temperature: 0.2,
    maxTokens: 1400,
    task: 'relation_extract',
    promptVersion: job.prompt_version ?? RELATION_EXTRACT_SYSTEM_PROMPT_VERSION,
    signal: currentRunSignal(job.run_id),
  });
  const parsed = parseJSON<{ relations?: RelationLLMSuggestion[] }>(raw);
  const conceptIds = new Set(sourceConcepts.map((concept) => concept.id));
  const titleById = new Map(sourceConcepts.map((concept) => [concept.id, concept.title]));

  let applied = 0;
  let queued = 0;
  for (const suggestion of (parsed.relations ?? []).slice(0, 40)) {
    const sourceConceptId = suggestion.sourceConceptId?.trim() || '';
    const targetConceptId = suggestion.targetConceptId?.trim() || '';
    if (
      !conceptIds.has(sourceConceptId) ||
      !conceptIds.has(targetConceptId) ||
      sourceConceptId === targetConceptId
    ) {
      continue;
    }
    const kind = normalizeWorkerRelationKind(suggestion.kind);
    const confidence =
      typeof suggestion.confidence === 'number'
        ? Math.max(0, Math.min(1, suggestion.confidence))
        : 0.6;
    const reason = suggestion.reason?.trim().slice(0, 500) || 'LLM 抽取的概念关系。';

    if (confidence >= RELATION_CONFIDENCE_AUTO_APPLY) {
      wikiRepo.upsertConceptRelation({
        sourceConceptId,
        targetConceptId,
        kind,
        reason,
        confidence,
      });
      wikiRepo.linkConceptPair(sourceConceptId, targetConceptId);
      applied += 1;
    } else {
      createReviewItem({
        kind: 'relation_suggestion',
        title: `关系建议：${titleById.get(sourceConceptId) ?? sourceConceptId} → ${
          titleById.get(targetConceptId) ?? targetConceptId
        }`,
        targetType: 'concept_relation',
        targetId: `${sourceConceptId}:${targetConceptId}:${kind}`,
        sourceId: source.id,
        confidence,
        payload: {
          sourceConceptId,
          targetConceptId,
          kind,
          reason,
          confidence,
          sourceTitle: titleById.get(sourceConceptId),
          targetTitle: titleById.get(targetConceptId),
        },
      });
      queued += 1;
    }
  }

  syncObs.recordEvent({
    runId: job.run_id,
    itemId: job.item_id,
    level: 'success',
    stage: 'relations',
    path: job.source_path,
    message: `关系抽取完成：自动写入 ${applied} 条，待审 ${queued} 条，legacy 同步 ${synced} 条`,
  });
  finishJob(job, 'succeeded');
}

async function processJob(job: AnalysisJobRow): Promise<void> {
  try {
    const inputHash = computeStageInputHash(job);
    getServerDb()
      .prepare(`UPDATE analysis_jobs SET input_hash = ? WHERE id = ?`)
      .run(inputHash, job.id);
    if (getCachedStageStatus(job, inputHash) === 'succeeded') {
      syncObs.recordEvent({
        runId: job.run_id,
        itemId: job.item_id,
        level: 'success',
        stage: job.stage,
        path: job.source_path,
        message: `输入 fingerprint 未变化，跳过 ${job.stage}`,
        meta: { event: 'analysis.stage_cache_hit', stage: job.stage },
      });
      finishJob(job, 'skipped', 'stage fingerprint unchanged');
      return;
    }

    if (isRunCancelled(job.run_id)) {
      finishJob(job, 'cancelled', 'run cancelled');
      return;
    }

    if (job.stage === 'github_ingest') {
      await withJobHeartbeat(job, () =>
        withBackgroundLlmBudget('github_ingest', job, () => processGithubIngest(job)),
      );
    } else if (job.stage === 'embedding') {
      await withJobHeartbeat(job, () =>
        withBackgroundLlmBudget('embedding', job, () => processEmbedding(job)),
      );
    } else if (job.stage === 'summarize') {
      await withJobHeartbeat(job, () =>
        withBackgroundLlmBudget('summarize', job, () => processSummarize(job)),
      );
    } else if (job.stage === 'relations') {
      await withJobHeartbeat(job, () =>
        withBackgroundLlmBudget('relations', job, () => processRelations(job)),
      );
    } else if (
      job.stage === 'qa_index' ||
      job.stage === 'chunk' ||
      job.stage === 'fts' ||
      job.stage === 'concepts'
    ) {
      await processQaIndex(job);
    } else {
      finishJob(job, 'skipped', `unknown stage: ${job.stage}`);
    }
  } catch (err) {
    if (classifyJobError(err) === 'cancelled') {
      finishJob(job, 'cancelled', err instanceof Error ? err.message : String(err));
      return;
    }
    failJob(job, err);
  }
}

export async function runAnalysisWorkerOnce(): Promise<{
  claimed: number;
  remaining: number;
  recovered: number;
}> {
  ensureAnalysisWorkerSchema();
  const recovery = recoverStaleAnalysisJobs();
  const jobs = claimJobs(WORKER_BATCH);
  await Promise.all(jobs.map((job) => processJob(job)));
  const remaining = Number(
    (
      getServerDb()
        .prepare(`SELECT COUNT(*) AS count FROM analysis_jobs WHERE status = 'queued'`)
        .get() as { count: number }
    ).count || 0,
  );
  return { claimed: jobs.length, remaining, recovered: recovery.jobs + recovery.items };
}

/**
 * Returned to the API caller so the UI can show a precise toast:
 * "started a new worker" vs "already 2 workers running" vs "nothing to do".
 */
export interface StartAnalysisWorkerResult {
  started: boolean;
  reason: string;
  activeWorkers: number;
  queued: number;
  recovered: number;
}

export function startAnalysisWorker(reason = 'manual'): StartAnalysisWorkerResult {
  ensureAnalysisWorkerSchema();
  // Always attempt recovery — dashboard polls every 2s, so this gives us a
  // free continuous lease-reaper without spinning a separate timer.
  const recovery = recoverStaleAnalysisJobs();

  const queued = Number(
    (
      getServerDb()
        .prepare(`SELECT COUNT(*) AS count FROM analysis_jobs WHERE status = 'queued'`)
        .get() as { count: number }
    ).count || 0,
  );

  if (queued === 0) {
    return {
      started: false,
      reason: 'no_queue',
      activeWorkers: activeWorkerCount,
      queued,
      recovered: recovery.jobs + recovery.items,
    };
  }

  if (activeWorkerCount >= MAX_PARALLEL_WORKERS) {
    return {
      started: false,
      reason: 'max_workers',
      activeWorkers: activeWorkerCount,
      queued,
      recovered: recovery.jobs + recovery.items,
    };
  }

  activeWorkerCount += 1;
  syncObs.recordEvent({
    stage: 'llm',
    message: `分析 worker 启动：${reason}（worker #${activeWorkerCount} · 队列 ${queued}）`,
  });
  const workerPromise = (async () => {
    try {
      for (let i = 0; i < WORKER_MAX_LOOPS; i += 1) {
        const result = await runAnalysisWorkerOnce();
        if (result.claimed === 0) break;
      }
    } finally {
      activeWorkerCount = Math.max(0, activeWorkerCount - 1);
      syncObs.recordEvent({ stage: 'llm', level: 'success', message: '分析 worker 空闲' });
    }
  })();
  const g = globalThis as unknown as { __activeAnalysisWorkerPromises?: Set<Promise<void>> };
  g.__activeAnalysisWorkerPromises ??= new Set();
  g.__activeAnalysisWorkerPromises.add(workerPromise);
  void workerPromise.finally(() => g.__activeAnalysisWorkerPromises?.delete(workerPromise));

  return {
    started: true,
    reason,
    activeWorkers: activeWorkerCount,
    queued,
    recovered: recovery.jobs + recovery.items,
  };
}

/** How many worker loops are currently in flight in this process. */
/**
 * Check both the in-memory abort controller and the persisted run status. The
 * DB check is the source of truth across worker restarts; the controller lets
 * in-flight fetches abort as soon as the user clicks cancel.
 */
export function isRunCancelled(runId: string | null | undefined): boolean {
  if (!runId) return false;
  const ctrl = cancelControllers.get(runId);
  if (ctrl?.signal.aborted) return true;
  const row = getServerDb()
    .prepare(`SELECT status FROM sync_runs WHERE id = ? LIMIT 1`)
    .get(runId) as { status?: string } | undefined;
  return row?.status === 'cancelled' || row?.status === 'failed';
}

export function abortRun(runId: string, reason = 'cancelled by user'): boolean {
  const ctrl = cancelControllers.get(runId);
  if (!ctrl) return false;
  try {
    ctrl.abort(new Error(reason));
  } catch {
    // ignore — already aborted
  }
  cancelControllers.delete(runId);
  return true;
}

export function retryAnalysisJobs(
  input: { runId?: string | null; itemId?: string | null; failedOnly?: boolean } = {},
): number {
  ensureAnalysisWorkerSchema();
  const clauses = [
    `status IN ('failed', 'cancelled')`,
    `NOT (stage = 'github_ingest' AND COALESCE(payload_json, '') = '')`,
  ];
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
          , dead_letter_at = NULL
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

  // Also signal in-flight fetches to abort cooperatively.
  if (input.runId) abortRun(input.runId, 'cancelled by user');

  // Mark stuck run_items as cancelled too so the dashboard stops claiming
  // those rows are still in flight.
  if (input.runId) {
    const ts = now();
    getServerDb()
      .prepare(
        `UPDATE sync_run_items
            SET status = 'cancelled',
                stage = 'complete',
                finished_at = ?,
                updated_at = ?,
                error = COALESCE(error, 'cancelled by user')
          WHERE run_id = ? AND status IN ('queued', 'running')`,
      )
      .run(ts, ts, input.runId);
  }
  return res.changes;
}
