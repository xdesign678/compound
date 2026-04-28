/**
 * Sync + analysis observability layer.
 *
 * This module is intentionally independent from `repo` in server-db.ts so it can
 * be added without rewriting the existing SQLite repository object. It creates
 * a set of append/summary tables that make GitHub sync and downstream analysis
 * visible at run-level, file-level, stage-level, and error-level.
 *
 * Server-only. Do not import from client components.
 */
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { getServerDb } from './server-db';
import { wikiRepo } from './wiki-db';
import { now } from './utils';

export type SyncRunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type SyncItemStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';
export type SyncChangeType = 'create' | 'update' | 'delete' | 'rename' | 'skip';
export type SyncStage =
  | 'queued'
  | 'scan'
  | 'diff'
  | 'download'
  | 'ingest'
  | 'chunk'
  | 'fts'
  | 'llm'
  | 'concepts'
  | 'evidence'
  | 'delete'
  | 'complete';

export type AnalysisStage =
  | 'chunk'
  | 'fts'
  | 'embedding'
  | 'summarize'
  | 'concepts'
  | 'relations'
  | 'qa_index';
export type AnalysisJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

type JsonObject = Record<string, unknown>;

export interface StartSyncRunInput {
  id: string;
  kind: 'github' | string;
  triggerType: 'manual' | 'webhook' | 'schedule' | string;
  repo?: string;
  branch?: string;
  headSha?: string;
}

export interface UpsertRunItemInput {
  id?: string;
  runId: string;
  path: string;
  oldSha?: string | null;
  newSha?: string | null;
  externalKey?: string | null;
  sourceId?: string | null;
  changeType: SyncChangeType;
  status?: SyncItemStatus;
  stage?: SyncStage;
}

export interface QueueAnalysisJobInput {
  sourceId: string;
  sourceSha?: string | null;
  sourcePath?: string | null;
  stage: AnalysisStage;
  stageVersion: string;
  model?: string | null;
  promptVersion?: string | null;
  status?: AnalysisJobStatus;
}

export interface SyncDashboard {
  now: number;
  activeRun: SyncRunRow | null;
  latestRuns: SyncRunRow[];
  activeItems: SyncRunItemRow[];
  failedItems: SyncRunItemRow[];
  events: SyncEventRow[];
  coverage: Record<string, number | string | boolean>;
  itemStats: Array<{ stage: string; status: string; count: number }>;
  analysisStats: Array<{ stage: string; status: string; count: number }>;
  errorStats: Array<{ error: string; count: number; lastAt: number }>;
  pipeline: PipelineStageRow[];
  errorGroups: ErrorGroupRow[];
  health: RunHealth;
  throughput: ThroughputBucket[];
  itemSummary: Record<SyncItemStatus, number>;
}

export interface PipelineStageRow {
  stage: string;
  label: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  skipped: number;
}

export interface ErrorGroupRow {
  fingerprint: string;
  category: 'timeout' | 'github' | 'auth' | 'parse' | 'rate' | 'gateway' | 'unknown';
  message: string;
  stage: string | null;
  count: number;
  lastAt: number;
  examples: Array<{ path: string; itemId: string }>;
  suggestion: string;
}

export interface RunHealth {
  startedAt: number | null;
  finishedAt: number | null;
  heartbeatAt: number | null;
  heartbeatAgeMs: number | null;
  runtimeMs: number | null;
  stalled: boolean;
  stalledFor: number;
  lastEventAt: number | null;
}

export interface ThroughputBucket {
  /** Bucket start (epoch ms, 1-minute buckets). */
  at: number;
  /** Items finished (succeeded) in this bucket. */
  done: number;
  /** Items failed in this bucket. */
  failed: number;
}

export interface SyncRunRow {
  id: string;
  kind: string;
  trigger_type: string;
  repo: string | null;
  branch: string | null;
  head_sha: string | null;
  status: SyncRunStatus;
  stage: SyncStage | string;
  total_files: number;
  changed_files: number;
  created_files: number;
  updated_files: number;
  deleted_files: number;
  skipped_files: number;
  done_files: number;
  failed_files: number;
  current: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  heartbeat_at: number | null;
}

export interface SyncRunItemRow {
  id: string;
  run_id: string;
  path: string;
  old_sha: string | null;
  new_sha: string | null;
  external_key: string | null;
  source_id: string | null;
  change_type: SyncChangeType;
  status: SyncItemStatus;
  stage: SyncStage | string;
  attempts: number;
  chunks: number | null;
  concepts_created: number | null;
  concepts_updated: number | null;
  evidence: number | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

export interface SyncEventRow {
  id: string;
  run_id: string | null;
  item_id: string | null;
  at: number;
  level: 'info' | 'warn' | 'error' | 'success';
  stage: string | null;
  path: string | null;
  message: string;
  meta: string | null;
}

let schemaReady = false;

function stableId(...parts: Array<string | null | undefined>): string {
  return crypto
    .createHash('sha1')
    .update(parts.map((part) => part ?? '').join('\u001f'))
    .digest('hex')
    .slice(0, 20);
}

function tableExists(tableName: string): boolean {
  const row = getServerDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`)
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function safeCount(sql: string): number {
  try {
    const row = getServerDb().prepare(sql).get() as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  } catch {
    return 0;
  }
}

const PIPELINE_STAGES: Array<{ stage: string; label: string }> = [
  { stage: 'github_ingest', label: '入库' },
  { stage: 'chunk', label: '分块' },
  { stage: 'fts', label: '全文索引' },
  { stage: 'embedding', label: '向量' },
  { stage: 'summarize', label: '摘要' },
  { stage: 'concepts', label: '概念' },
  { stage: 'qa_index', label: '问答索引' },
];

/**
 * Bucket the most recent error rows into stable groups by category +
 * normalized message. We deliberately do this in JS rather than SQL so the
 * categorization rules can evolve freely.
 */
function classifyError(raw: string): {
  category: ErrorGroupRow['category'];
  fingerprint: string;
  suggestion: string;
} {
  const text = raw.toLowerCase();
  if (/llm call exceeded wall-clock|wall-clock budget/.test(text)) {
    return {
      category: 'timeout',
      fingerprint: 'timeout-wallclock',
      suggestion: 'LLM 调用达到总时长上限。提高 COMPOUND_LLM_TIMEOUT_MS 或换一个更快的模型。',
    };
  }
  if (/stream stalled|no chunk for/.test(text)) {
    return {
      category: 'timeout',
      fingerprint: 'timeout-stream-idle',
      suggestion:
        'Streaming 模式下模型停止吐字超过 idle 阈值。可能是上游网关阻塞，或模型本身陷入死循环。',
    };
  }
  if (/timed?\s*out|abortederror|operation was aborted/.test(text)) {
    return {
      category: 'timeout',
      fingerprint: 'timeout',
      suggestion:
        '网络/上游超时。如多个文件同时撞同一秒数，多半是 COMPOUND_LLM_TIMEOUT_MS 设得过短。',
    };
  }
  if (/github\s+(404|not found)/.test(text) || /\b404\b.+\/repos\//.test(text)) {
    return {
      category: 'github',
      fingerprint: 'github-404',
      suggestion: '远端文件未找到，多见于路径含特殊字符或文件已被改名/删除。',
    };
  }
  if (/\b(401|403)\b|unauthorized|forbidden/.test(text)) {
    return {
      category: 'auth',
      fingerprint: 'auth',
      suggestion: '凭证失效。检查 GITHUB_TOKEN 或 LLM_API_KEY 是否过期。',
    };
  }
  if (/rate\s*limit|x-ratelimit/.test(text)) {
    return {
      category: 'rate',
      fingerprint: 'rate-limit',
      suggestion: '触发限流。等几分钟再试，或换更高配额的 token。',
    };
  }
  if (/circuit\s+open|gateway_(5\d\d|429)|circuitbreaker/.test(text)) {
    return {
      category: 'gateway',
      fingerprint: 'gateway',
      suggestion: 'LLM 网关近期连续失败，熔断器打开。等待自动恢复或检查上游。',
    };
  }
  if (/payload is incomplete|invalid json|parse/.test(text)) {
    return {
      category: 'parse',
      fingerprint: 'parse',
      suggestion: '内部数据结构异常，通常需要看 server log（含 requestId）。',
    };
  }
  return {
    category: 'unknown',
    fingerprint: 'unknown',
    suggestion: '未识别错误。可先重试一次；持续失败请查看事件流。',
  };
}

function decodeMaybe(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function json(value: JsonObject | undefined): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

export function ensureSyncObservabilitySchema(): void {
  if (schemaReady) return;
  const db = getServerDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      repo TEXT,
      branch TEXT,
      head_sha TEXT,
      status TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'queued',
      total_files INTEGER NOT NULL DEFAULT 0,
      changed_files INTEGER NOT NULL DEFAULT 0,
      created_files INTEGER NOT NULL DEFAULT 0,
      updated_files INTEGER NOT NULL DEFAULT 0,
      deleted_files INTEGER NOT NULL DEFAULT 0,
      skipped_files INTEGER NOT NULL DEFAULT 0,
      done_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      current TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      heartbeat_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at ON sync_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_status_started ON sync_runs(status, started_at DESC);

    CREATE TABLE IF NOT EXISTS sync_run_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      path TEXT NOT NULL,
      old_sha TEXT,
      new_sha TEXT,
      external_key TEXT,
      source_id TEXT,
      change_type TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      chunks INTEGER,
      concepts_created INTEGER,
      concepts_updated INTEGER,
      evidence INTEGER,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(run_id) REFERENCES sync_runs(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_run_items_run_path ON sync_run_items(run_id, path);
    CREATE INDEX IF NOT EXISTS idx_sync_run_items_run_status ON sync_run_items(run_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_run_items_path ON sync_run_items(path);

    CREATE TABLE IF NOT EXISTS source_file_state (
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      path TEXT NOT NULL,
      source_id TEXT,
      external_key TEXT,
      blob_sha TEXT,
      status TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      deleted_at INTEGER,
      last_sync_run_id TEXT,
      PRIMARY KEY(repo, branch, path)
    );
    CREATE INDEX IF NOT EXISTS idx_source_file_state_status ON source_file_state(status, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_source_file_state_source ON source_file_state(source_id);

    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_sha TEXT,
      source_path TEXT,
      stage TEXT NOT NULL,
      stage_version TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cost_estimate REAL,
      error TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(source_id, source_sha, stage, stage_version, model, prompt_version)
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status_stage ON analysis_jobs(status, stage, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_analysis_jobs_source ON analysis_jobs(source_id, source_sha);

    CREATE TABLE IF NOT EXISTS sync_events (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      item_id TEXT,
      at INTEGER NOT NULL,
      level TEXT NOT NULL,
      stage TEXT,
      path TEXT,
      message TEXT NOT NULL,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_events_run_at ON sync_events(run_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_sync_events_level_at ON sync_events(level, at DESC);
  `);
  schemaReady = true;
}

export const syncObs = {
  ensureSchema: ensureSyncObservabilitySchema,

  startRun(input: StartSyncRunInput): void {
    ensureSyncObservabilitySchema();
    const ts = now();
    getServerDb()
      .prepare(
        `INSERT OR REPLACE INTO sync_runs
         (id, kind, trigger_type, repo, branch, head_sha, status, stage, started_at, heartbeat_at)
         VALUES (@id, @kind, @trigger_type, @repo, @branch, @head_sha, 'running', 'queued', @started_at, @heartbeat_at)`,
      )
      .run({
        id: input.id,
        kind: input.kind,
        trigger_type: input.triggerType,
        repo: input.repo ?? null,
        branch: input.branch ?? null,
        head_sha: input.headSha ?? null,
        started_at: ts,
        heartbeat_at: ts,
      });
  },

  updateRun(
    id: string,
    patch: Partial<{
      repo: string | null;
      branch: string | null;
      head_sha: string | null;
      status: SyncRunStatus;
      stage: SyncStage | string;
      total_files: number;
      changed_files: number;
      created_files: number;
      updated_files: number;
      deleted_files: number;
      skipped_files: number;
      done_files: number;
      failed_files: number;
      current: string | null;
      error: string | null;
      finished_at: number | null;
      heartbeat_at: number | null;
    }>,
  ): void {
    ensureSyncObservabilitySchema();
    const existing = getServerDb().prepare(`SELECT * FROM sync_runs WHERE id = ?`).get(id) as
      | SyncRunRow
      | undefined;
    if (!existing) return;
    const next = {
      ...existing,
      ...patch,
      heartbeat_at:
        patch.heartbeat_at ??
        (patch.status === 'done' || patch.status === 'failed' ? existing.heartbeat_at : now()),
    };
    getServerDb()
      .prepare(
        `UPDATE sync_runs SET
          repo = @repo,
          branch = @branch,
          head_sha = @head_sha,
          status = @status,
          stage = @stage,
          total_files = @total_files,
          changed_files = @changed_files,
          created_files = @created_files,
          updated_files = @updated_files,
          deleted_files = @deleted_files,
          skipped_files = @skipped_files,
          done_files = @done_files,
          failed_files = @failed_files,
          current = @current,
          error = @error,
          finished_at = @finished_at,
          heartbeat_at = @heartbeat_at
         WHERE id = @id`,
      )
      .run(next);
  },

  finishRun(
    id: string,
    status: Extract<SyncRunStatus, 'done' | 'failed' | 'cancelled'>,
    error?: string | null,
  ): void {
    this.updateRun(id, {
      status,
      stage: 'complete',
      current: null,
      error: error ?? null,
      finished_at: now(),
      heartbeat_at: now(),
    });
  },

  upsertRunItem(input: UpsertRunItemInput): string {
    ensureSyncObservabilitySchema();
    const ts = now();
    const id = input.id ?? `sri-${stableId(input.runId, input.path)}`;
    getServerDb()
      .prepare(
        `INSERT INTO sync_run_items
          (id, run_id, path, old_sha, new_sha, external_key, source_id, change_type, status, stage, updated_at)
         VALUES
          (@id, @run_id, @path, @old_sha, @new_sha, @external_key, @source_id, @change_type, @status, @stage, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
          old_sha = excluded.old_sha,
          new_sha = excluded.new_sha,
          external_key = excluded.external_key,
          source_id = COALESCE(excluded.source_id, sync_run_items.source_id),
          change_type = excluded.change_type,
          status = excluded.status,
          stage = excluded.stage,
          updated_at = excluded.updated_at`,
      )
      .run({
        id,
        run_id: input.runId,
        path: input.path,
        old_sha: input.oldSha ?? null,
        new_sha: input.newSha ?? null,
        external_key: input.externalKey ?? null,
        source_id: input.sourceId ?? null,
        change_type: input.changeType,
        status: input.status ?? 'queued',
        stage: input.stage ?? 'queued',
        updated_at: ts,
      });
    return id;
  },

  updateRunItem(
    id: string,
    patch: Partial<{
      source_id: string | null;
      status: SyncItemStatus;
      stage: SyncStage | string;
      attempts: number;
      chunks: number | null;
      concepts_created: number | null;
      concepts_updated: number | null;
      evidence: number | null;
      error: string | null;
      started_at: number | null;
      finished_at: number | null;
    }>,
  ): void {
    ensureSyncObservabilitySchema();
    const row = getServerDb().prepare(`SELECT * FROM sync_run_items WHERE id = ?`).get(id) as
      | SyncRunItemRow
      | undefined;
    if (!row) return;
    const next = {
      ...row,
      ...patch,
      updated_at: now(),
      started_at: patch.started_at ?? row.started_at ?? (patch.status === 'running' ? now() : null),
      finished_at:
        patch.finished_at ??
        row.finished_at ??
        (['succeeded', 'failed', 'skipped', 'cancelled'].includes(patch.status ?? '')
          ? now()
          : null),
    };
    getServerDb()
      .prepare(
        `UPDATE sync_run_items SET
          source_id = @source_id,
          status = @status,
          stage = @stage,
          attempts = @attempts,
          chunks = @chunks,
          concepts_created = @concepts_created,
          concepts_updated = @concepts_updated,
          evidence = @evidence,
          error = @error,
          started_at = @started_at,
          finished_at = @finished_at,
          updated_at = @updated_at
         WHERE id = @id`,
      )
      .run(next);
  },

  recordEvent(input: {
    runId?: string | null;
    itemId?: string | null;
    level?: SyncEventRow['level'];
    stage?: SyncStage | AnalysisStage | string | null;
    path?: string | null;
    message: string;
    meta?: JsonObject;
  }): void {
    ensureSyncObservabilitySchema();
    getServerDb()
      .prepare(
        `INSERT INTO sync_events (id, run_id, item_id, at, level, stage, path, message, meta)
         VALUES (@id, @run_id, @item_id, @at, @level, @stage, @path, @message, @meta)`,
      )
      .run({
        id: `se-${nanoid(10)}`,
        run_id: input.runId ?? null,
        item_id: input.itemId ?? null,
        at: now(),
        level: input.level ?? 'info',
        stage: input.stage ?? null,
        path: input.path ?? null,
        message: input.message,
        meta: json(input.meta),
      });
  },

  markSourceFileActive(input: {
    repo: string;
    branch: string;
    path: string;
    sourceId?: string | null;
    externalKey?: string | null;
    blobSha?: string | null;
    runId?: string | null;
  }): void {
    ensureSyncObservabilitySchema();
    const ts = now();
    getServerDb()
      .prepare(
        `INSERT INTO source_file_state
          (repo, branch, path, source_id, external_key, blob_sha, status, first_seen_at, last_seen_at, deleted_at, last_sync_run_id)
         VALUES
          (@repo, @branch, @path, @source_id, @external_key, @blob_sha, 'active', @first_seen_at, @last_seen_at, NULL, @last_sync_run_id)
         ON CONFLICT(repo, branch, path) DO UPDATE SET
          source_id = COALESCE(excluded.source_id, source_file_state.source_id),
          external_key = COALESCE(excluded.external_key, source_file_state.external_key),
          blob_sha = COALESCE(excluded.blob_sha, source_file_state.blob_sha),
          status = 'active',
          last_seen_at = excluded.last_seen_at,
          deleted_at = NULL,
          last_sync_run_id = excluded.last_sync_run_id`,
      )
      .run({
        repo: input.repo,
        branch: input.branch,
        path: input.path,
        source_id: input.sourceId ?? null,
        external_key: input.externalKey ?? null,
        blob_sha: input.blobSha ?? null,
        first_seen_at: ts,
        last_seen_at: ts,
        last_sync_run_id: input.runId ?? null,
      });
  },

  markSourceFileDeleted(input: {
    repo: string;
    branch: string;
    path: string;
    runId?: string | null;
  }): void {
    ensureSyncObservabilitySchema();
    const ts = now();
    getServerDb()
      .prepare(
        `INSERT INTO source_file_state
          (repo, branch, path, source_id, external_key, blob_sha, status, first_seen_at, last_seen_at, deleted_at, last_sync_run_id)
         VALUES
          (@repo, @branch, @path, NULL, NULL, NULL, 'deleted', @first_seen_at, @last_seen_at, @deleted_at, @last_sync_run_id)
         ON CONFLICT(repo, branch, path) DO UPDATE SET
          status = 'deleted',
          deleted_at = COALESCE(source_file_state.deleted_at, excluded.deleted_at),
          last_sync_run_id = excluded.last_sync_run_id,
          last_seen_at = excluded.last_seen_at`,
      )
      .run({
        repo: input.repo,
        branch: input.branch,
        path: input.path,
        first_seen_at: ts,
        deleted_at: ts,
        last_seen_at: ts,
        last_sync_run_id: input.runId ?? null,
      });
  },

  queueAnalysisJob(input: QueueAnalysisJobInput): string {
    ensureSyncObservabilitySchema();
    const id = `aj-${stableId(
      input.sourceId,
      input.sourceSha,
      input.stage,
      input.stageVersion,
      input.model,
      input.promptVersion,
    )}`;
    const ts = now();
    getServerDb()
      .prepare(
        `INSERT INTO analysis_jobs
          (id, source_id, source_sha, source_path, stage, stage_version, model, prompt_version, status, updated_at)
         VALUES
          (@id, @source_id, @source_sha, @source_path, @stage, @stage_version, @model, @prompt_version, @status, @updated_at)
         ON CONFLICT(source_id, source_sha, stage, stage_version, model, prompt_version) DO UPDATE SET
          source_path = excluded.source_path,
          status = excluded.status,
          updated_at = excluded.updated_at,
          finished_at = CASE WHEN excluded.status IN ('succeeded', 'failed', 'skipped') THEN excluded.updated_at ELSE analysis_jobs.finished_at END`,
      )
      .run({
        id,
        source_id: input.sourceId,
        source_sha: input.sourceSha ?? null,
        source_path: input.sourcePath ?? null,
        stage: input.stage,
        stage_version: input.stageVersion,
        model: input.model ?? null,
        prompt_version: input.promptVersion ?? null,
        status: input.status ?? 'queued',
        updated_at: ts,
      });
    return id;
  },

  getDashboard(): SyncDashboard {
    ensureSyncObservabilitySchema();
    // wikiRepo.getMetrics() also ensures wiki compiler schema, including FTS tables when possible.
    let wikiMetrics: Record<string, number | boolean> = {};
    try {
      wikiRepo.ensureSchema();
      wikiMetrics = wikiRepo.getMetrics();
    } catch {
      wikiMetrics = {};
    }
    const db = getServerDb();
    const activeRun = db
      .prepare(`SELECT * FROM sync_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`)
      .get() as SyncRunRow | undefined;
    const latestRuns = db
      .prepare(`SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10`)
      .all() as SyncRunRow[];
    const runForDetails = activeRun?.id ?? latestRuns[0]?.id ?? null;
    const activeItems = runForDetails
      ? (db
          .prepare(
            `SELECT * FROM sync_run_items WHERE run_id = ? ORDER BY updated_at DESC LIMIT 200`,
          )
          .all(runForDetails) as SyncRunItemRow[])
      : [];
    const failedItems = db
      .prepare(
        `SELECT * FROM sync_run_items WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 100`,
      )
      .all() as SyncRunItemRow[];
    const events = db
      .prepare(`SELECT * FROM sync_events ORDER BY at DESC LIMIT 80`)
      .all() as SyncEventRow[];
    const itemStats = db
      .prepare(
        `SELECT stage, status, COUNT(*) AS count FROM sync_run_items GROUP BY stage, status ORDER BY stage, status`,
      )
      .all() as Array<{ stage: string; status: string; count: number }>;
    const analysisStats = db
      .prepare(
        `SELECT stage, status, COUNT(*) AS count FROM analysis_jobs GROUP BY stage, status ORDER BY stage, status`,
      )
      .all() as Array<{ stage: string; status: string; count: number }>;
    const errorStats = db
      .prepare(
        `SELECT COALESCE(error, '未知错误') AS error, COUNT(*) AS count, MAX(updated_at) AS lastAt
         FROM sync_run_items
         WHERE status = 'failed'
         GROUP BY COALESCE(error, '未知错误')
         ORDER BY count DESC, lastAt DESC
         LIMIT 20`,
      )
      .all() as Array<{ error: string; count: number; lastAt: number }>;

    const coverage = {
      sources: safeCount(`SELECT COUNT(*) AS count FROM sources`),
      githubSources: safeCount(
        `SELECT COUNT(*) AS count FROM sources WHERE external_key LIKE 'github:%'`,
      ),
      activeSourceFiles: safeCount(
        `SELECT COUNT(*) AS count FROM source_file_state WHERE status = 'active'`,
      ),
      deletedSourceFiles: safeCount(
        `SELECT COUNT(*) AS count FROM source_file_state WHERE status = 'deleted'`,
      ),
      sourceChunks: safeCount(`SELECT COUNT(*) AS count FROM source_chunks`),
      chunkFtsRows: tableExists('chunk_fts')
        ? safeCount(`SELECT COUNT(*) AS count FROM chunk_fts`)
        : 0,
      concepts: safeCount(`SELECT COUNT(*) AS count FROM concepts`),
      conceptEvidence: safeCount(`SELECT COUNT(*) AS count FROM concept_evidence`),
      conceptVersions: safeCount(`SELECT COUNT(*) AS count FROM concept_versions`),
      modelRuns: tableExists('model_runs')
        ? safeCount(`SELECT COUNT(*) AS count FROM model_runs`)
        : 0,
      analysisQueued: safeCount(
        `SELECT COUNT(*) AS count FROM analysis_jobs WHERE status = 'queued'`,
      ),
      analysisFailed: safeCount(
        `SELECT COUNT(*) AS count FROM analysis_jobs WHERE status = 'failed'`,
      ),
      ftsReady: Boolean((wikiMetrics as Record<string, unknown>).ftsReady),
    };

    // ---- Pipeline rollup -------------------------------------------------
    const stageRows = runForDetails
      ? (db
          .prepare(
            `SELECT stage, status, COUNT(*) AS count
               FROM analysis_jobs
              WHERE run_id = ?
              GROUP BY stage, status`,
          )
          .all(runForDetails) as Array<{ stage: string; status: string; count: number }>)
      : (db
          .prepare(
            `SELECT stage, status, COUNT(*) AS count
               FROM analysis_jobs
              GROUP BY stage, status`,
          )
          .all() as Array<{ stage: string; status: string; count: number }>);

    const pipelineMap = new Map<string, PipelineStageRow>();
    for (const { stage, label } of PIPELINE_STAGES) {
      pipelineMap.set(stage, {
        stage,
        label,
        total: 0,
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        skipped: 0,
      });
    }
    for (const row of stageRows) {
      const entry =
        pipelineMap.get(row.stage) ??
        ({
          stage: row.stage,
          label: row.stage,
          total: 0,
          queued: 0,
          running: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
          skipped: 0,
        } as PipelineStageRow);
      const count = Number(row.count || 0);
      entry.total += count;
      const key = row.status as keyof PipelineStageRow;
      if (key in entry && key !== 'stage' && key !== 'label' && key !== 'total') {
        (entry as unknown as Record<string, number>)[key] =
          ((entry as unknown as Record<string, number>)[key] || 0) + count;
      }
      pipelineMap.set(row.stage, entry);
    }
    const pipeline: PipelineStageRow[] = PIPELINE_STAGES.map(
      ({ stage }) => pipelineMap.get(stage)!,
    );

    // ---- Error grouping (decoded + classified) ---------------------------
    const errorRowsStmt = runForDetails
      ? db.prepare(
          `SELECT id, path, error, stage, updated_at FROM sync_run_items
            WHERE run_id = ? AND status = 'failed' AND error IS NOT NULL
            ORDER BY updated_at DESC LIMIT 200`,
        )
      : db.prepare(
          `SELECT id, path, error, stage, updated_at FROM sync_run_items
            WHERE status = 'failed' AND error IS NOT NULL
            ORDER BY updated_at DESC LIMIT 200`,
        );
    const errorRows = (
      runForDetails ? errorRowsStmt.all(runForDetails) : errorRowsStmt.all()
    ) as Array<{
      id: string;
      path: string;
      error: string;
      stage: string | null;
      updated_at: number;
    }>;
    const errorGroupsMap = new Map<string, ErrorGroupRow>();
    for (const row of errorRows) {
      const cls = classifyError(row.error);
      const key = `${cls.fingerprint}::${row.stage ?? ''}`;
      const decodedPath = decodeMaybe(row.path);
      let entry = errorGroupsMap.get(key);
      if (!entry) {
        entry = {
          fingerprint: cls.fingerprint,
          category: cls.category,
          message: row.error.slice(0, 240),
          stage: row.stage,
          count: 0,
          lastAt: 0,
          examples: [],
          suggestion: cls.suggestion,
        };
        errorGroupsMap.set(key, entry);
      }
      entry.count += 1;
      entry.lastAt = Math.max(entry.lastAt, Number(row.updated_at) || 0);
      if (entry.examples.length < 3) {
        entry.examples.push({ path: decodedPath, itemId: row.id });
      }
    }
    const errorGroups: ErrorGroupRow[] = Array.from(errorGroupsMap.values()).sort(
      (a, b) => b.count - a.count || b.lastAt - a.lastAt,
    );

    // ---- Run health ------------------------------------------------------
    const baseRun = activeRun ?? latestRuns[0] ?? null;
    const ts = now();
    const heartbeatAgeMs = baseRun?.heartbeat_at != null ? ts - baseRun.heartbeat_at : null;
    const lastEventAt = events[0]?.at ?? null;
    const stalled =
      baseRun?.status === 'running' && heartbeatAgeMs != null && heartbeatAgeMs > 60_000;
    const health: RunHealth = {
      startedAt: baseRun?.started_at ?? null,
      finishedAt: baseRun?.finished_at ?? null,
      heartbeatAt: baseRun?.heartbeat_at ?? null,
      heartbeatAgeMs,
      runtimeMs: baseRun?.started_at ? (baseRun.finished_at ?? ts) - baseRun.started_at : null,
      stalled,
      stalledFor: stalled && heartbeatAgeMs != null ? heartbeatAgeMs : 0,
      lastEventAt,
    };

    // ---- Throughput (1-minute buckets, last 30 minutes) ------------------
    const throughputCutoff = ts - 30 * 60_000;
    const throughputStmt = runForDetails
      ? db.prepare(
          `SELECT
              (finished_at / 60000) * 60000 AS bucket,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM sync_run_items
            WHERE run_id = ? AND finished_at IS NOT NULL AND finished_at >= ?
            GROUP BY bucket
            ORDER BY bucket ASC`,
        )
      : db.prepare(
          `SELECT
              (finished_at / 60000) * 60000 AS bucket,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
            FROM sync_run_items
            WHERE finished_at IS NOT NULL AND finished_at >= ?
            GROUP BY bucket
            ORDER BY bucket ASC`,
        );
    const throughputRows = (
      runForDetails
        ? throughputStmt.all(runForDetails, throughputCutoff)
        : throughputStmt.all(throughputCutoff)
    ) as Array<{
      bucket: number;
      done: number;
      failed: number;
    }>;
    const throughput: ThroughputBucket[] = throughputRows.map((row) => ({
      at: Number(row.bucket),
      done: Number(row.done || 0),
      failed: Number(row.failed || 0),
    }));

    // ---- Item summary by status -----------------------------------------
    const summaryRows = runForDetails
      ? (db
          .prepare(
            `SELECT status, COUNT(*) AS count FROM sync_run_items WHERE run_id = ? GROUP BY status`,
          )
          .all(runForDetails) as Array<{ status: string; count: number }>)
      : ([] as Array<{ status: string; count: number }>);
    const itemSummary: Record<SyncItemStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
    };
    for (const row of summaryRows) {
      if (row.status in itemSummary) {
        itemSummary[row.status as SyncItemStatus] = Number(row.count || 0);
      }
    }

    return {
      now: ts,
      activeRun: activeRun ?? null,
      latestRuns,
      activeItems,
      failedItems,
      events,
      coverage,
      itemStats,
      analysisStats,
      errorStats,
      pipeline,
      errorGroups,
      health,
      throughput,
      itemSummary,
    };
  },
};
