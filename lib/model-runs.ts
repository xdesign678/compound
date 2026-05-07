/**
 * Thin writer for the `model_runs` telemetry table.
 *
 * Records every LLM call with model / task / token counts / latency so we can
 * surface cost + slow-stage dashboards. Best-effort: any failure is swallowed
 * so telemetry never breaks the main pipeline.
 *
 * The schema is created lazily inside `ensureWikiCompilerSchema()` (wiki-db.ts)
 * but we also create-if-missing here so the module can be called from code
 * paths that don't touch the Wiki compiler.
 */

import { nanoid } from 'nanoid';
import { logger } from './logging';
import { getServerDb } from './server-db';

let schemaReady = false;
let schemaDb: unknown = null;

function ensureSchema(): void {
  const db = getServerDb();
  if (schemaReady && schemaDb === db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS model_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT,
        provider TEXT,
        model TEXT NOT NULL,
        task TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        latency_ms INTEGER,
        cost_usd REAL,
        prompt_hash TEXT,
        output_hash TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_runs_task ON model_runs(task, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_model_runs_created ON model_runs(created_at DESC);
    `);
    schemaReady = true;
    schemaDb = db;
  } catch (err) {
    // Telemetry must never crash the request path.
    logger.warn('model_runs.schema_init_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface ModelRunRecord {
  model: string;
  task: string;
  jobId?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  costUsd?: number;
  promptHash?: string;
  outputHash?: string;
  /** Non-null marker for failure runs (finish_length / gateway_5xx / unexpected_shape). */
  error?: string;
}

export interface ModelRunUsageSummary {
  windowDays: number;
  totals: {
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
  };
  byDay: Array<{
    day: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  byModel: Array<{
    model: string;
    runs: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number | null;
  }>;
  byTask: Array<{
    task: string;
    runs: number;
    costUsd: number;
    avgLatencyMs: number | null;
  }>;
  recentFailures: Array<{
    task: string;
    model: string;
    createdAt: number;
  }>;
}

/**
 * Fire-and-forget insert. Never throws.
 */
export function recordModelRun(record: ModelRunRecord): void {
  try {
    ensureSchema();
    if (!schemaReady) return;
    const db = getServerDb();
    const stmt = db.prepare(
      `INSERT INTO model_runs
       (id, job_id, provider, model, task, input_tokens, output_tokens, latency_ms, cost_usd, prompt_hash, output_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // `error` is folded into `task` with a suffix so we don't need an extra column.
    const task = record.error ? `${record.task}:${record.error}` : record.task;
    stmt.run(
      nanoid(),
      record.jobId ?? null,
      record.provider ?? null,
      record.model,
      task,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.latencyMs ?? null,
      record.costUsd ?? null,
      record.promptHash ?? null,
      record.outputHash ?? null,
      Date.now(),
    );
  } catch (err) {
    logger.warn('model_runs.insert_failed', {
      task: record.task,
      model: record.model,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getModelRunUsageSummary(windowDays = 14): ModelRunUsageSummary {
  ensureSchema();
  const days = Math.max(1, Math.min(90, Math.trunc(windowDays)));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const db = getServerDb();

  const totalsRow = db
    .prepare(
      `SELECT
         COUNT(*) AS runs,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd), 0) AS costUsd,
         AVG(latency_ms) AS avgLatencyMs
       FROM model_runs
       WHERE created_at >= ?`,
    )
    .get(since) as Record<string, unknown>;

  const byDayRows = db
    .prepare(
      `SELECT
         date(created_at / 1000, 'unixepoch', 'localtime') AS day,
         COUNT(*) AS runs,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM model_runs
       WHERE created_at >= ?
       GROUP BY day
       ORDER BY day ASC`,
    )
    .all(since) as Array<Record<string, unknown>>;

  const byModelRows = db
    .prepare(
      `SELECT
         model,
         COUNT(*) AS runs,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(cost_usd), 0) AS costUsd,
         AVG(latency_ms) AS avgLatencyMs
       FROM model_runs
       WHERE created_at >= ?
       GROUP BY model
       ORDER BY costUsd DESC, runs DESC
       LIMIT 24`,
    )
    .all(since) as Array<Record<string, unknown>>;

  const byTaskRows = db
    .prepare(
      `SELECT
         task,
         COUNT(*) AS runs,
         COALESCE(SUM(cost_usd), 0) AS costUsd,
         AVG(latency_ms) AS avgLatencyMs
       FROM model_runs
       WHERE created_at >= ?
       GROUP BY task
       ORDER BY costUsd DESC, runs DESC
       LIMIT 32`,
    )
    .all(since) as Array<Record<string, unknown>>;

  const failureRows = db
    .prepare(
      `SELECT task, model, created_at
       FROM model_runs
       WHERE created_at >= ? AND instr(task, ':') > 0
       ORDER BY created_at DESC
       LIMIT 12`,
    )
    .all(since) as Array<Record<string, unknown>>;

  return {
    windowDays: days,
    totals: {
      runs: numberValue(totalsRow.runs),
      inputTokens: numberValue(totalsRow.inputTokens),
      outputTokens: numberValue(totalsRow.outputTokens),
      costUsd: numberValue(totalsRow.costUsd),
      avgLatencyMs: nullableNumber(totalsRow.avgLatencyMs),
    },
    byDay: byDayRows.map((row) => ({
      day: String(row.day),
      runs: numberValue(row.runs),
      inputTokens: numberValue(row.inputTokens),
      outputTokens: numberValue(row.outputTokens),
      costUsd: numberValue(row.costUsd),
    })),
    byModel: byModelRows.map((row) => ({
      model: String(row.model),
      runs: numberValue(row.runs),
      inputTokens: numberValue(row.inputTokens),
      outputTokens: numberValue(row.outputTokens),
      costUsd: numberValue(row.costUsd),
      avgLatencyMs: nullableNumber(row.avgLatencyMs),
    })),
    byTask: byTaskRows.map((row) => ({
      task: String(row.task),
      runs: numberValue(row.runs),
      costUsd: numberValue(row.costUsd),
      avgLatencyMs: nullableNumber(row.avgLatencyMs),
    })),
    recentFailures: failureRows.map((row) => ({
      task: String(row.task),
      model: String(row.model),
      createdAt: numberValue(row.created_at),
    })),
  };
}
