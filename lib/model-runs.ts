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

function ensureSchema(): void {
  if (schemaReady) return;
  try {
    const db = getServerDb();
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

/** Retention helper — call from a daily cron or admin route. */
export function pruneModelRuns(olderThanMs: number): number {
  try {
    ensureSchema();
    if (!schemaReady) return 0;
    const cutoff = Date.now() - olderThanMs;
    const db = getServerDb();
    const res = db.prepare('DELETE FROM model_runs WHERE created_at < ?').run(cutoff);
    return typeof res.changes === 'number' ? res.changes : 0;
  } catch (err) {
    logger.warn('model_runs.prune_failed', {
      olderThanMs,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
