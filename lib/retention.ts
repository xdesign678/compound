/**
 * Data retention / GC for high-frequency append-only tables.
 *
 * Caps the unbounded growth of `sync_events`, `model_runs`,
 * `source_analysis_stage_cache` and `concept_versions` (per concept), purges
 * orphaned `concept_evidence` / `concept_relations` / `chunk_embeddings`, and
 * opportunistically checkpoints the WAL. Limits are configurable via
 * `COMPOUND_RETENTION_*` env vars with safe (large) defaults so a default
 * deployment never deletes active data.
 *
 * Triggered opportunistically from the existing worker tick and sync wrap-up
 * via `maybeRunRetention()` (throttled). No resident timer is created, so this
 * module cannot leak a background loop. `runRetention()` is the direct,
 * unthrottled entry point used by tests.
 *
 * Server-only: touches better-sqlite3.
 */

import type { Database as DB } from 'better-sqlite3';

import { ensureAnalysisWorkerSchema } from './analysis-worker';
import { logger } from './logging';
import { getServerDb } from './server-db';
import { ensureSyncObservabilitySchema } from './sync-observability';
import { ensureWikiCompilerSchema } from './wiki-db';

export interface TableRetentionLimit {
  maxRows: number;
  maxAgeDays: number;
}

export interface RetentionLimits {
  syncEvents: TableRetentionLimit;
  modelRuns: TableRetentionLimit;
  stageCache: TableRetentionLimit;
  conceptVersionsPerConcept: number;
}

export interface RetentionResult {
  syncEventsDeleted: number;
  modelRunsDeleted: number;
  stageCacheDeleted: number;
  conceptVersionsDeleted: number;
  orphanEvidenceDeleted: number;
  orphanRelationsDeleted: number;
  orphanChunkEmbeddingsDeleted: number;
  checkpointed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_LIMITS: RetentionLimits = {
  syncEvents: { maxRows: 50_000, maxAgeDays: 90 },
  modelRuns: { maxRows: 100_000, maxAgeDays: 180 },
  stageCache: { maxRows: 50_000, maxAgeDays: 120 },
  conceptVersionsPerConcept: 50,
};

const DEFAULT_MIN_INTERVAL_MS = 5 * 60_000;
const RETENTION_LAST_RUN_KEY = '__compound_retention_last_run__';

function envInt(name: string, fallback: number, min: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

export function resolveRetentionLimits(overrides?: Partial<RetentionLimits>): RetentionLimits {
  const base: RetentionLimits = {
    syncEvents: {
      maxRows: envInt(
        'COMPOUND_RETENTION_SYNC_EVENTS_MAX_ROWS',
        DEFAULT_LIMITS.syncEvents.maxRows,
        1,
      ),
      maxAgeDays: envInt(
        'COMPOUND_RETENTION_SYNC_EVENTS_MAX_AGE_DAYS',
        DEFAULT_LIMITS.syncEvents.maxAgeDays,
        1,
      ),
    },
    modelRuns: {
      maxRows: envInt(
        'COMPOUND_RETENTION_MODEL_RUNS_MAX_ROWS',
        DEFAULT_LIMITS.modelRuns.maxRows,
        1,
      ),
      maxAgeDays: envInt(
        'COMPOUND_RETENTION_MODEL_RUNS_MAX_AGE_DAYS',
        DEFAULT_LIMITS.modelRuns.maxAgeDays,
        1,
      ),
    },
    stageCache: {
      maxRows: envInt(
        'COMPOUND_RETENTION_STAGE_CACHE_MAX_ROWS',
        DEFAULT_LIMITS.stageCache.maxRows,
        1,
      ),
      maxAgeDays: envInt(
        'COMPOUND_RETENTION_STAGE_CACHE_MAX_AGE_DAYS',
        DEFAULT_LIMITS.stageCache.maxAgeDays,
        1,
      ),
    },
    conceptVersionsPerConcept: envInt(
      'COMPOUND_RETENTION_CONCEPT_VERSIONS_MAX',
      DEFAULT_LIMITS.conceptVersionsPerConcept,
      1,
    ),
  };
  if (!overrides) return base;
  return {
    syncEvents: { ...base.syncEvents, ...overrides.syncEvents },
    modelRuns: { ...base.modelRuns, ...overrides.modelRuns },
    stageCache: { ...base.stageCache, ...overrides.stageCache },
    conceptVersionsPerConcept:
      overrides.conceptVersionsPerConcept ?? base.conceptVersionsPerConcept,
  };
}

function tableExists(db: DB, name: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { name?: string } | undefined;
  return Boolean(row?.name);
}

/**
 * Cap an append-only table by age then by row count, keeping the newest rows.
 * `rowKey` is the column used to identify rows for the count cap — `rowid` works
 * for tables with a composite primary key (`source_analysis_stage_cache`).
 */
function trimByAgeAndCount(
  db: DB,
  table: string,
  timeColumn: string,
  rowKey: string,
  limit: TableRetentionLimit,
  now: number,
): number {
  if (!tableExists(db, table)) return 0;
  const cutoff = now - limit.maxAgeDays * DAY_MS;
  let deleted = 0;
  deleted += Number(
    db.prepare(`DELETE FROM ${table} WHERE ${timeColumn} < ?`).run(cutoff).changes || 0,
  );
  deleted += Number(
    db
      .prepare(
        `DELETE FROM ${table}
          WHERE ${rowKey} NOT IN (
            SELECT ${rowKey} FROM ${table} ORDER BY ${timeColumn} DESC LIMIT ?
          )`,
      )
      .run(limit.maxRows).changes || 0,
  );
  return deleted;
}

/** Keep only the newest `maxPerConcept` versions for each concept. */
function trimConceptVersions(db: DB, maxPerConcept: number): number {
  if (!tableExists(db, 'concept_versions')) return 0;
  return Number(
    db
      .prepare(
        `DELETE FROM concept_versions
          WHERE id IN (
            SELECT id FROM (
              SELECT id,
                     ROW_NUMBER() OVER (PARTITION BY concept_id ORDER BY version DESC) AS rn
              FROM concept_versions
            )
            WHERE rn > ?
          )`,
      )
      .run(maxPerConcept).changes || 0,
  );
}

function deleteOrphanEvidence(db: DB): number {
  if (!tableExists(db, 'concept_evidence')) return 0;
  return Number(
    db
      .prepare(
        `DELETE FROM concept_evidence
          WHERE id IN (
            SELECT ev.id
            FROM concept_evidence ev
            LEFT JOIN concepts c ON c.id = ev.concept_id
            LEFT JOIN sources s ON s.id = ev.source_id
            LEFT JOIN source_chunks ch ON ch.id = ev.chunk_id
            WHERE c.id IS NULL
               OR s.id IS NULL
               OR (ev.chunk_id IS NOT NULL AND ch.id IS NULL)
          )`,
      )
      .run().changes || 0,
  );
}

function deleteOrphanRelations(db: DB): number {
  if (!tableExists(db, 'concept_relations')) return 0;
  return Number(
    db
      .prepare(
        `DELETE FROM concept_relations
          WHERE id IN (
            SELECT rel.id
            FROM concept_relations rel
            LEFT JOIN concepts source ON source.id = rel.source_concept_id
            LEFT JOIN concepts target ON target.id = rel.target_concept_id
            WHERE source.id IS NULL OR target.id IS NULL
          )`,
      )
      .run().changes || 0,
  );
}

function deleteOrphanChunkEmbeddings(db: DB): number {
  if (!tableExists(db, 'chunk_embeddings')) return 0;
  return Number(
    db
      .prepare(
        `DELETE FROM chunk_embeddings
          WHERE chunk_id IN (
            SELECT emb.chunk_id
            FROM chunk_embeddings emb
            LEFT JOIN source_chunks ch ON ch.id = emb.chunk_id
            LEFT JOIN sources s ON s.id = emb.source_id
            WHERE ch.id IS NULL OR s.id IS NULL
          )`,
      )
      .run().changes || 0,
  );
}

/**
 * Run all retention passes once, unconditionally. Each pass is independent and
 * idempotent; missing tables are skipped. Safe to call from tests directly.
 */
export function runRetention(overrides?: Partial<RetentionLimits>): RetentionResult {
  const limits = resolveRetentionLimits(overrides);
  ensureSyncObservabilitySchema();
  ensureWikiCompilerSchema();
  ensureAnalysisWorkerSchema();
  const db = getServerDb();
  const now = Date.now();

  const result: RetentionResult = {
    syncEventsDeleted: trimByAgeAndCount(db, 'sync_events', 'at', 'id', limits.syncEvents, now),
    modelRunsDeleted: trimByAgeAndCount(
      db,
      'model_runs',
      'created_at',
      'id',
      limits.modelRuns,
      now,
    ),
    stageCacheDeleted: trimByAgeAndCount(
      db,
      'source_analysis_stage_cache',
      'updated_at',
      'rowid',
      limits.stageCache,
      now,
    ),
    conceptVersionsDeleted: trimConceptVersions(db, limits.conceptVersionsPerConcept),
    orphanEvidenceDeleted: deleteOrphanEvidence(db),
    orphanRelationsDeleted: deleteOrphanRelations(db),
    orphanChunkEmbeddingsDeleted: deleteOrphanChunkEmbeddings(db),
    checkpointed: false,
  };

  try {
    db.pragma('wal_checkpoint(PASSIVE)');
    result.checkpointed = true;
  } catch {
    // Checkpointing is opportunistic; never let it surface as an error.
  }

  return result;
}

function lastRunHolder(): { value: number } {
  const g = globalThis as unknown as { [k: string]: { value: number } | undefined };
  if (!g[RETENTION_LAST_RUN_KEY]) g[RETENTION_LAST_RUN_KEY] = { value: 0 };
  return g[RETENTION_LAST_RUN_KEY] as { value: number };
}

/**
 * Opportunistic, throttled entry point for the worker tick / sync wrap-up.
 * Runs `runRetention` at most once per `COMPOUND_RETENTION_MIN_INTERVAL_MS`
 * (default 5 min). Never throws — retention must not break the caller's path.
 * Returns the retention result when it ran, or `null` when throttled/failed.
 */
export function maybeRunRetention(overrides?: Partial<RetentionLimits>): RetentionResult | null {
  const minInterval = envInt('COMPOUND_RETENTION_MIN_INTERVAL_MS', DEFAULT_MIN_INTERVAL_MS, 0);
  const holder = lastRunHolder();
  const now = Date.now();
  if (now - holder.value < minInterval) return null;
  holder.value = now;
  try {
    return runRetention(overrides);
  } catch (err) {
    logger.warn('retention.run_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
