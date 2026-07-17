/**
 * Server-side SQLite layer.
 * Powered by better-sqlite3 (synchronous API, zero-config).
 *
 * Storage path:
 *   - $DATA_DIR/compound.db  (production, backed by a mounted Volume)
 *   - ./data/compound.db     (dev fallback)
 *
 * This module MUST NEVER be imported from client code — it uses native
 * Node.js bindings. All imports must live under `app/api/**` or `lib/server-*`.
 */

import Database, { type Database as DB, type Statement } from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeCategoryState } from './category-normalization';
import { instrumentDatabase } from './observability/query-analyzer';
import type {
  Source,
  Concept,
  ActivityLog,
  AskMessage,
  CategoryTag,
  ContentStatus,
  SourceType,
  ActivityType,
  CategoryWiki,
} from './types';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const MIN_DIRECT_TITLE_MENTION_LENGTH = 2;

function resolveDbPath(): string {
  const dir = process.env.DATA_DIR?.trim() || DEFAULT_DATA_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'compound.db');
}

/** Singleton: survives Next.js dev hot-reloads. */
const globalKey = '__compound_sqlite__';
interface Holder {
  db: DB;
  path: string;
}

function getHolder(): Holder {
  const g = globalThis as unknown as { [k: string]: Holder | undefined };
  if (g[globalKey]) return g[globalKey] as Holder;

  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  // Performance & durability tuning.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('wal_autocheckpoint = 1000');

  runMigrations(db);
  try {
    db.pragma('wal_checkpoint(PASSIVE)');
  } catch {
    // Checkpointing is opportunistic; boot should continue if SQLite skips it.
  }
  // ANALYZE refreshes the query planner's statistics so large SELECTs pick
  // the correct index after schema-introducing migrations. Cheap on small
  // DBs (<100ms), and idempotent — safe to run unconditionally at startup.
  try {
    db.exec('ANALYZE;');
  } catch {
    // ANALYZE is best-effort; a corrupted stats table must not block boot.
  }
  // After migrations finish, install the query analyzer so every prepared
  // statement records its fingerprint, duration, and error state into the
  // active query scope. Disabled by setting COMPOUND_DISABLE_QUERY_ANALYZER=1.
  instrumentDatabase(db);

  const holder: Holder = { db, path: dbPath };
  g[globalKey] = holder;
  return holder;
}

export function getServerDb(): DB {
  return getHolder().db;
}

// --------------------------------------------------------------------
// Prepared statement cache
// --------------------------------------------------------------------

/**
 * Module-scope cache so hot-path queries don't re-prepare the same SQL on
 * every request. `better-sqlite3` .prepare() parses and compiles the SQL each
 * call (≈50-150µs on typical statements), which adds up across the thousands
 * of per-request reads in this app.
 *
 * The cache is keyed by the raw SQL string and re-bound to the current DB
 * instance. When the singleton rotates (tests / hot reload), all cached
 * statements are invalidated in one shot to avoid operating on a closed
 * Database handle.
 */
let cachedDbForPrepare: DB | null = null;
const preparedStatementCache = new Map<string, Statement<unknown[]>>();

function cachedPrepare(sql: string): Statement<unknown[]> {
  const db = getServerDb();
  if (db !== cachedDbForPrepare) {
    cachedDbForPrepare = db;
    preparedStatementCache.clear();
  }
  let stmt = preparedStatementCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql) as Statement<unknown[]>;
    preparedStatementCache.set(sql, stmt);
  }
  return stmt;
}

// --------------------------------------------------------------------
// Migrations
// --------------------------------------------------------------------

function runMigrations(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id            TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      type          TEXT NOT NULL,
      author        TEXT,
      url           TEXT,
      raw_content   TEXT NOT NULL,
      ingested_at   INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      external_key  TEXT,
      last_synced_commit_sha TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sources_ingested_at ON sources(ingested_at);
    CREATE INDEX IF NOT EXISTS idx_sources_external_key ON sources(external_key);

    CREATE TABLE IF NOT EXISTS concepts (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      summary         TEXT NOT NULL,
      body            TEXT NOT NULL,
      sources         TEXT NOT NULL,  -- JSON array of source ids
      related         TEXT NOT NULL,  -- JSON array of {id, kind}
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      version         INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_concepts_updated_at ON concepts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_concepts_created_at ON concepts(created_at);
    CREATE INDEX IF NOT EXISTS idx_concepts_title_ci ON concepts(title COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS activity (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      details         TEXT,            -- optional long text
      source_ids      TEXT NOT NULL,   -- JSON array
      concept_ids     TEXT NOT NULL,   -- JSON array
      at              INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
    CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(type);

    CREATE TABLE IF NOT EXISTS ask_history (
      id                   TEXT PRIMARY KEY,
      role                 TEXT NOT NULL,  -- 'user' | 'assistant'
      text                 TEXT NOT NULL,
      cited_concepts       TEXT,           -- JSON array
      saved_as_concept_id  TEXT,
      suggested_title      TEXT,
      suggested_summary    TEXT,
      at                   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ask_history_at ON ask_history(at);

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,        -- 'github'
      status      TEXT NOT NULL,        -- 'running' | 'done' | 'failed'
      total       INTEGER NOT NULL DEFAULT 0,
      done        INTEGER NOT NULL DEFAULT 0,
      failed      INTEGER NOT NULL DEFAULT 0,
      current     TEXT,                 -- current path
      log         TEXT,                 -- JSON array of recent entries (ring buffer)
      error       TEXT,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_started_at ON sync_jobs(started_at);
    -- Hot path: getActiveSyncJob + recoverStaleSyncJobs both filter on status='running'.
    CREATE INDEX IF NOT EXISTS idx_sync_jobs_status_started ON sync_jobs(status, started_at);
    -- Activity chronology by type (for filtered dashboards).
    CREATE INDEX IF NOT EXISTS idx_activity_type_at ON activity(type, at DESC);

    CREATE TABLE IF NOT EXISTS meta (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_wikis (
      id                  TEXT PRIMARY KEY,
      primary_category    TEXT NOT NULL,
      secondary_category  TEXT NOT NULL,
      body_md             TEXT NOT NULL DEFAULT '',
      toc_json            TEXT NOT NULL DEFAULT '[]',
      concept_ids         TEXT NOT NULL DEFAULT '[]',
      concept_ids_hash    TEXT NOT NULL DEFAULT '',
      model               TEXT,
      prompt_version      TEXT,
      generated_at        INTEGER NOT NULL,
      stale               INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_category_wikis_pair
      ON category_wikis(primary_category, secondary_category);

    CREATE TABLE IF NOT EXISTS category_wiki_runs (
      id                  TEXT PRIMARY KEY,
      primary_category    TEXT NOT NULL,
      secondary_category  TEXT NOT NULL,
      status              TEXT NOT NULL,
      phase               TEXT NOT NULL DEFAULT 'queued',
      request_json        TEXT NOT NULL,
      result_json         TEXT,
      error               TEXT,
      started_at          INTEGER NOT NULL,
      finished_at         INTEGER,
      updated_at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_category_wiki_runs_status
      ON category_wiki_runs(status, started_at DESC);

    CREATE TABLE IF NOT EXISTS sync_changes (
      seq          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT NOT NULL,
      operation    TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')),
      changed_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_entity
      ON sync_changes(entity_type, entity_id, seq DESC);
  `);

  const conceptColumns = new Set(
    (db.prepare(`PRAGMA table_info(concepts)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );

  if (!conceptColumns.has('categories')) {
    db.exec(`ALTER TABLE concepts ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';`);
  }

  if (!conceptColumns.has('category_keys')) {
    db.exec(`ALTER TABLE concepts ADD COLUMN category_keys TEXT NOT NULL DEFAULT '[]';`);
  }

  const syncJobColumns = new Set(
    (db.prepare(`PRAGMA table_info(sync_jobs)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  if (!syncJobColumns.has('heartbeat_at')) {
    db.exec(`ALTER TABLE sync_jobs ADD COLUMN heartbeat_at INTEGER;`);
  }

  const sourceColumns = new Set(
    (db.prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  if (!sourceColumns.has('last_synced_commit_sha')) {
    db.exec(`ALTER TABLE sources ADD COLUMN last_synced_commit_sha TEXT;`);
  }
  if (!sourceColumns.has('updated_at')) {
    db.exec(`ALTER TABLE sources ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;`);
  }
  db.exec(`
    UPDATE sources SET updated_at = ingested_at WHERE updated_at <= 0;
    CREATE INDEX IF NOT EXISTS idx_sources_updated_at ON sources(updated_at);
  `);

  runCategoryNormalizationIfNeeded(db);
  backfillSyncChangesIfNeeded(db);
}

const SYNC_CHANGE_BACKFILL_REVISION = '2026-07-sync-change-log-v1';

function backfillSyncChangesIfNeeded(db: DB): void {
  const row = db
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .get('sync_change_backfill_revision') as { value: string } | undefined;
  if (row?.value === SYNC_CHANGE_BACKFILL_REVISION) return;

  const insert = db.prepare(
    `INSERT INTO sync_changes(entity_type, entity_id, operation, changed_at)
     VALUES (?, ?, 'upsert', ?)`,
  );
  db.transaction(() => {
    for (const source of db.prepare(`SELECT id, updated_at FROM sources`).all() as Array<{
      id: string;
      updated_at: number;
    }>) {
      insert.run('source', source.id, source.updated_at);
    }
    for (const concept of db.prepare(`SELECT id, updated_at FROM concepts`).all() as Array<{
      id: string;
      updated_at: number;
    }>) {
      insert.run('concept', concept.id, concept.updated_at);
    }
    for (const activity of db.prepare(`SELECT id, at FROM activity`).all() as Array<{
      id: string;
      at: number;
    }>) {
      insert.run('activity', activity.id, activity.at);
    }
    for (const ask of db.prepare(`SELECT id, at FROM ask_history`).all() as Array<{
      id: string;
      at: number;
    }>) {
      insert.run('ask', ask.id, ask.at);
    }
    db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`).run(
      'sync_change_backfill_revision',
      SYNC_CHANGE_BACKFILL_REVISION,
    );
  })();
}

/**
 * Schema revision identifies the normalization routine. Bump this string when
 * `normalizeCategoryState` rules change and we need to re-run on every row.
 */
const CATEGORY_NORMALIZATION_REVISION = '2026-04-categories-v2';

function runCategoryNormalizationIfNeeded(db: DB): void {
  const row = db
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .get('concept_categories_revision') as { value: string } | undefined;
  if (row?.value === CATEGORY_NORMALIZATION_REVISION) return;

  normalizeStoredConceptCategories(db);

  db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`).run(
    'concept_categories_revision',
    CATEGORY_NORMALIZATION_REVISION,
  );
}

function normalizeStoredConceptCategories(db: DB): void {
  const rows = db.prepare(`SELECT id, categories, category_keys FROM concepts`).all() as Array<{
    id: string;
    categories: string;
    category_keys: string;
  }>;

  const update = db.prepare(
    `UPDATE concepts
     SET categories = @categories, category_keys = @category_keys
     WHERE id = @id`,
  );

  const run = db.transaction(() => {
    for (const row of rows) {
      const parsedCategories = parseJsonArray<CategoryTag>(row.categories);
      const parsedCategoryKeys = parseJsonArray<string>(row.category_keys);
      const normalized = normalizeCategoryState({
        categories: parsedCategories,
        categoryKeys: parsedCategoryKeys,
      });
      const nextCategories = JSON.stringify(normalized.categories);
      const nextCategoryKeys = JSON.stringify(normalized.categoryKeys);
      // Skip rows that are already canonical to avoid pointless writes / WAL churn.
      if (nextCategories === row.categories && nextCategoryKeys === row.category_keys) continue;
      update.run({
        id: row.id,
        categories: nextCategories,
        category_keys: nextCategoryKeys,
      });
    }
  });
  run();
}

// --------------------------------------------------------------------
// Row <-> domain mappers
// --------------------------------------------------------------------

interface SourceRow {
  id: string;
  title: string;
  type: string;
  author: string | null;
  url: string | null;
  raw_content: string;
  ingested_at: number;
  updated_at: number;
  external_key: string | null;
  last_synced_commit_sha: string | null;
}

interface ConceptRow {
  id: string;
  title: string;
  summary: string;
  body: string;
  sources: string;
  related: string;
  categories: string;
  category_keys: string;
  created_at: number;
  updated_at: number;
  version: number;
}

interface ActivityRow {
  id: string;
  type: string;
  title: string;
  details: string | null;
  source_ids: string;
  concept_ids: string;
  at: number;
}

interface AskRow {
  id: string;
  role: string;
  text: string;
  cited_concepts: string | null;
  saved_as_concept_id: string | null;
  suggested_title: string | null;
  suggested_summary: string | null;
  at: number;
}

interface TimeWindowOptions {
  after?: number;
  before?: number;
}

interface TimeWindowWithLimit extends TimeWindowOptions {
  limit?: number;
  offset?: number;
}

interface RecordQueryOptions extends TimeWindowWithLimit {
  summariesOnly?: boolean;
}

export type SyncEntityType = 'source' | 'concept' | 'activity' | 'ask';
export type SyncOperation = 'upsert' | 'delete';

export interface SyncChange {
  seq: number;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  changedAt: number;
}

function recordSyncChange(
  entityType: SyncEntityType,
  entityId: string,
  operation: SyncOperation,
  changedAt = Date.now(),
): void {
  getServerDb()
    .prepare(
      `INSERT INTO sync_changes(entity_type, entity_id, operation, changed_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(entityType, entityId, operation, Math.trunc(changedAt));
}

function parseJsonArray<T>(s: string | null | undefined, fallback: T[] = []): T[] {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function buildTimeWindowClause(
  column: string,
  options: TimeWindowOptions = {},
): {
  clause: string;
  params: number[];
} {
  const clauses: string[] = [];
  const params: number[] = [];

  if (typeof options.after === 'number' && Number.isFinite(options.after)) {
    clauses.push(`${column} > ?`);
    params.push(Math.trunc(options.after));
  }

  if (typeof options.before === 'number' && Number.isFinite(options.before)) {
    clauses.push(`${column} <= ?`);
    params.push(Math.trunc(options.before));
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function buildLimitClause(options: TimeWindowWithLimit = {}): {
  clause: string;
  params: number[];
} {
  const clauses: string[] = [];
  const params: number[] = [];

  if (typeof options.limit === 'number' && Number.isFinite(options.limit)) {
    clauses.push('LIMIT ?');
    params.push(Math.max(0, Math.trunc(options.limit)));
  }

  if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    if (clauses.length === 0) {
      clauses.push('LIMIT -1');
    }
    clauses.push('OFFSET ?');
    params.push(Math.max(0, Math.trunc(options.offset)));
  }

  return {
    clause: clauses.length > 0 ? ` ${clauses.join(' ')}` : '',
    params,
  };
}

function rowToSource(r: SourceRow, contentStatus: ContentStatus = 'full'): Source {
  return {
    id: r.id,
    title: r.title,
    type: r.type as SourceType,
    author: r.author ?? undefined,
    url: r.url ?? undefined,
    rawContent: r.raw_content,
    ingestedAt: r.ingested_at,
    updatedAt: r.updated_at,
    contentStatus,
    externalKey: r.external_key ?? undefined,
    lastSyncedCommitSha: r.last_synced_commit_sha ?? undefined,
  };
}

function rowToConcept(r: ConceptRow, contentStatus: ContentStatus = 'full'): Concept {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    body: r.body,
    sources: parseJsonArray<string>(r.sources),
    related: parseJsonArray<string>(r.related),
    categories: parseJsonArray<CategoryTag>(r.categories),
    categoryKeys: parseJsonArray<string>(r.category_keys),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
    contentStatus,
  };
}

function selectSourceColumns(summariesOnly = false): string {
  return summariesOnly
    ? `id, title, type, author, url, '' AS raw_content, ingested_at, updated_at, external_key, last_synced_commit_sha`
    : '*';
}

function selectConceptColumns(summariesOnly = false): string {
  return summariesOnly
    ? `id, title, summary, '' AS body, sources, related, categories, category_keys, created_at, updated_at, version`
    : '*';
}

function mapRowsById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function jsonArrayValueLikePattern(value: string): string {
  return `%${escapeLikePattern(JSON.stringify(value))}%`;
}

function normalizeSearchText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function mergeConceptCandidateLists(groups: Concept[][], limit: number): Concept[] {
  const seen = new Set<string>();
  const out: Concept[] = [];
  for (const group of groups) {
    for (const concept of group) {
      if (seen.has(concept.id)) continue;
      seen.add(concept.id);
      out.push(concept);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function findDirectTitleMentionConcepts(searchText: string, limit: number): Concept[] {
  const normalizedSearchText = normalizeSearchText(searchText);
  if (normalizedSearchText.length === 0) return [];

  const rows = cachedPrepare(
    `SELECT ${selectConceptColumns(true)}
       FROM concepts
       WHERE length(trim(title)) >= ?
         AND instr(?, lower(title)) > 0
       ORDER BY length(title) DESC, updated_at DESC
       LIMIT ?`,
  ).all(MIN_DIRECT_TITLE_MENTION_LENGTH, normalizedSearchText, limit) as ConceptRow[];

  return rows.map((row) => rowToConcept(row, 'partial'));
}

function rowToActivity(r: ActivityRow): ActivityLog {
  return {
    id: r.id,
    type: r.type as ActivityType,
    title: r.title,
    details: r.details ?? '',
    relatedSourceIds: parseJsonArray<string>(r.source_ids),
    relatedConceptIds: parseJsonArray<string>(r.concept_ids),
    at: r.at,
  };
}

function rowToAsk(r: AskRow): AskMessage {
  return {
    id: r.id,
    role: r.role as AskMessage['role'],
    text: r.text,
    citedConcepts: r.cited_concepts ? parseJsonArray<string>(r.cited_concepts) : undefined,
    savedAsConceptId: r.saved_as_concept_id ?? undefined,
    suggestedTitle: r.suggested_title ?? undefined,
    suggestedSummary: r.suggested_summary ?? undefined,
    at: r.at,
  };
}

// --------------------------------------------------------------------
// Category keys cache – avoids full table scan on every call.
// --------------------------------------------------------------------

let _categoryKeysCache: { keys: string[]; ts: number } | null = null;
const CATEGORY_CACHE_TTL = 30_000; // 30 seconds

function invalidateCategoryKeysCache(): void {
  _categoryKeysCache = null;
}

/**
 * Concept upserts are the hottest write path (every ingest / merge / sync
 * touches it). Only drop the cache when the write introduces a key the cache
 * has not seen — keys that merely became unused stay until the 30s TTL
 * expires, which is an acceptable staleness bound.
 */
function noteCategoryKeysOnWrite(keys: string[] | undefined): void {
  if (!_categoryKeysCache) return;
  const cached = new Set(_categoryKeysCache.keys);
  if ((keys ?? []).some((key) => !cached.has(key))) {
    _categoryKeysCache = null;
  }
}

// --------------------------------------------------------------------
// Public repository API
// --------------------------------------------------------------------

export const repo = {
  // ---- monotonic cloud-sync change log -------------------------
  getLatestSyncCursor(): number {
    const row = cachedPrepare(`SELECT COALESCE(MAX(seq), 0) AS cursor FROM sync_changes`).get() as
      | { cursor: number }
      | undefined;
    return Number(row?.cursor ?? 0);
  },

  getSyncCursorFloor(): number {
    const row = cachedPrepare(`SELECT value FROM meta WHERE key = 'sync_change_floor'`).get() as
      | { value: string }
      | undefined;
    const parsed = Number(row?.value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
  },

  compactSyncChanges(options: { maxRows: number; maxAgeDays: number; now?: number }): number {
    const db = getServerDb();
    const now = options.now ?? Date.now();
    const cutoff = now - Math.max(1, options.maxAgeDays) * 24 * 60 * 60 * 1000;
    const ageRow = db
      .prepare(`SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes WHERE changed_at < ?`)
      .get(cutoff) as { seq: number };
    const countRow = db
      .prepare(`SELECT seq FROM sync_changes ORDER BY seq DESC LIMIT 1 OFFSET ?`)
      .get(Math.max(1, Math.trunc(options.maxRows))) as { seq: number } | undefined;
    const floor = Math.max(Number(ageRow.seq || 0), Number(countRow?.seq || 0));
    if (floor <= 0) return 0;

    return db.transaction(() => {
      const result = db
        .prepare(
          `DELETE FROM sync_changes
            WHERE seq <= ?
              AND seq NOT IN (
                SELECT MAX(seq) FROM sync_changes GROUP BY entity_type, entity_id
              )`,
        )
        .run(floor);
      const previousFloor = repo.getSyncCursorFloor();
      db.prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES('sync_change_floor', ?)`).run(
        String(Math.max(previousFloor, floor)),
      );
      return Number(result.changes || 0);
    })();
  },

  listSyncChanges(options: { after: number; before: number; limit: number }): SyncChange[] {
    const limit = Math.max(1, Math.min(5000, Math.trunc(options.limit)));
    const rows = cachedPrepare(
      `SELECT seq, entity_type, entity_id, operation, changed_at
         FROM sync_changes
        WHERE seq > ? AND seq <= ?
        ORDER BY seq ASC
        LIMIT ?`,
    ).all(Math.trunc(options.after), Math.trunc(options.before), limit) as Array<{
      seq: number;
      entity_type: SyncEntityType;
      entity_id: string;
      operation: SyncOperation;
      changed_at: number;
    }>;
    return rows.map((row) => ({
      seq: row.seq,
      entityType: row.entity_type,
      entityId: row.entity_id,
      operation: row.operation,
      changedAt: row.changed_at,
    }));
  },

  listEntityIdsAtSyncCursor(
    entityType: SyncEntityType,
    cursor: number,
    options: { limit: number; offset: number },
  ): string[] {
    const limit = Math.max(1, Math.min(5000, Math.trunc(options.limit)));
    const offset = Math.max(0, Math.trunc(options.offset));
    const rows = getServerDb()
      .prepare(
        `WITH latest AS (
           SELECT entity_id, MAX(seq) AS seq
             FROM sync_changes
            WHERE entity_type = ? AND seq <= ?
            GROUP BY entity_id
         )
         SELECT latest.entity_id
           FROM latest
           JOIN sync_changes change ON change.seq = latest.seq
          WHERE change.operation = 'upsert'
          ORDER BY latest.seq DESC
          LIMIT ? OFFSET ?`,
      )
      .all(entityType, Math.trunc(cursor), limit, offset) as Array<{ entity_id: string }>;
    return rows.map((row) => row.entity_id);
  },

  countEntityIdsAtSyncCursor(entityType: SyncEntityType, cursor: number): number {
    const row = getServerDb()
      .prepare(
        `WITH latest AS (
           SELECT entity_id, MAX(seq) AS seq
             FROM sync_changes
            WHERE entity_type = ? AND seq <= ?
            GROUP BY entity_id
         )
         SELECT COUNT(*) AS count
           FROM latest
           JOIN sync_changes change ON change.seq = latest.seq
          WHERE change.operation = 'upsert'`,
      )
      .get(entityType, Math.trunc(cursor)) as { count: number } | undefined;
    return Number(row?.count ?? 0);
  },

  // ---- sources ---------------------------------------------------
  insertSource(s: Source): void {
    const previous = cachedPrepare(`SELECT updated_at FROM sources WHERE id = ?`).get(s.id) as
      | { updated_at: number }
      | undefined;
    const requestedUpdatedAt = s.updatedAt ?? s.ingestedAt;
    const updatedAt = previous
      ? Math.max(requestedUpdatedAt, previous.updated_at + 1)
      : requestedUpdatedAt;
    cachedPrepare(
      `INSERT OR REPLACE INTO sources
          (id, title, type, author, url, raw_content, ingested_at, updated_at, external_key, last_synced_commit_sha)
          VALUES (@id, @title, @type, @author, @url, @raw_content, @ingested_at, @updated_at, @external_key, @last_synced_commit_sha)`,
    ).run({
      id: s.id,
      title: s.title,
      type: s.type,
      author: s.author ?? null,
      url: s.url ?? null,
      raw_content: s.rawContent,
      ingested_at: s.ingestedAt,
      updated_at: updatedAt,
      external_key: s.externalKey ?? null,
      last_synced_commit_sha: s.lastSyncedCommitSha ?? null,
    });
    recordSyncChange('source', s.id, 'upsert', updatedAt);
  },

  getSource(id: string): Source | null {
    const row = cachedPrepare(`SELECT * FROM sources WHERE id = ?`).get(id) as
      | SourceRow
      | undefined;
    return row ? rowToSource(row) : null;
  },

  getSourceByExternalKey(key: string): Source | null {
    const row = cachedPrepare(`SELECT * FROM sources WHERE external_key = ?`).get(key) as
      | SourceRow
      | undefined;
    return row ? rowToSource(row) : null;
  },

  deleteSource(id: string): void {
    if (!id) return;
    const db = getServerDb();
    db.transaction(() => {
      const affected = db
        .prepare(`SELECT * FROM concepts WHERE sources LIKE ? ESCAPE '\\'`)
        .all(jsonArrayValueLikePattern(id)) as ConceptRow[];
      const updatedAt = Date.now();
      for (const row of affected) {
        const concept = rowToConcept(row);
        if (!concept.sources.includes(id)) continue;
        repo.upsertConcept({
          ...concept,
          sources: concept.sources.filter((sourceId) => sourceId !== id),
          updatedAt,
          version: concept.version + 1,
        });
      }
      db.prepare(`DELETE FROM sources WHERE id = ?`).run(id);
      recordSyncChange('source', id, 'delete', updatedAt);
    })();
  },

  updateSourceLastSyncedCommitSha(id: string, commitSha: string): void {
    const updatedAt = Date.now();
    const result = cachedPrepare(
      `UPDATE sources SET last_synced_commit_sha = ?, updated_at = ? WHERE id = ?`,
    ).run(commitSha, updatedAt, id);
    if (result.changes > 0) recordSyncChange('source', id, 'upsert', updatedAt);
  },

  updateGithubSourcesLastSyncedCommitSha(repoSlug: string, commitSha: string): number {
    const db = getServerDb();
    const ids = db
      .prepare(`SELECT id FROM sources WHERE external_key LIKE ?`)
      .all(`github:${repoSlug}:%`) as Array<{ id: string }>;
    if (ids.length === 0) return 0;
    const updatedAt = Date.now();
    db.transaction(() => {
      db.prepare(
        `UPDATE sources SET last_synced_commit_sha = ?, updated_at = ? WHERE external_key LIKE ?`,
      ).run(commitSha, updatedAt, `github:${repoSlug}:%`);
      for (const row of ids) recordSyncChange('source', row.id, 'upsert', updatedAt);
    })();
    return ids.length;
  },

  listSources(options: RecordQueryOptions = {}): Source[] {
    const { clause, params } = buildTimeWindowClause('ingested_at', options);
    const { clause: limitClause, params: limitParams } = buildLimitClause(options);
    const rows = getServerDb()
      .prepare(
        `SELECT ${selectSourceColumns(options.summariesOnly)} FROM sources ${clause} ORDER BY ingested_at DESC${limitClause}`,
      )
      .all(...params, ...limitParams) as SourceRow[];
    return rows.map((row) => rowToSource(row, options.summariesOnly ? 'partial' : 'full'));
  },

  countSources(options: TimeWindowOptions = {}): number {
    const { clause, params } = buildTimeWindowClause('ingested_at', options);
    const row = cachedPrepare(`SELECT COUNT(*) AS count FROM sources ${clause}`).get(...params) as
      | { count: number }
      | undefined;
    return Number(row?.count ?? 0);
  },

  getSourcesByIds(ids: string[], options: { summariesOnly?: boolean } = {}): Source[] {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = getServerDb()
      .prepare(
        `SELECT ${selectSourceColumns(options.summariesOnly)} FROM sources WHERE id IN (${placeholders})`,
      )
      .all(...uniqueIds) as SourceRow[];
    const rowMap = mapRowsById(
      rows.map((row) => rowToSource(row, options.summariesOnly ? 'partial' : 'full')),
    );
    return uniqueIds.map((id) => rowMap.get(id)).filter((row): row is Source => Boolean(row));
  },

  /**
   * Return all external keys whose prefix matches `github:`; used for dedup in sync.
   */
  listGithubExternalKeys(): Array<{
    id: string;
    externalKey: string;
    lastSyncedCommitSha: string | null;
  }> {
    const rows = cachedPrepare(
      `SELECT id, external_key, last_synced_commit_sha FROM sources WHERE external_key LIKE 'github:%'`,
    ).all() as Array<{
      id: string;
      external_key: string;
      last_synced_commit_sha: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      externalKey: r.external_key,
      lastSyncedCommitSha: r.last_synced_commit_sha,
    }));
  },

  // ---- concepts --------------------------------------------------
  upsertConcept(c: Concept): void {
    const previous = cachedPrepare(`SELECT updated_at FROM concepts WHERE id = ?`).get(c.id) as
      | { updated_at: number }
      | undefined;
    const updatedAt = previous ? Math.max(c.updatedAt, previous.updated_at + 1) : c.updatedAt;
    cachedPrepare(
      `INSERT OR REPLACE INTO concepts
          (id, title, summary, body, sources, related, categories, category_keys, created_at, updated_at, version)
          VALUES (@id, @title, @summary, @body, @sources, @related, @categories, @category_keys, @created_at, @updated_at, @version)`,
    ).run({
      id: c.id,
      title: c.title,
      summary: c.summary,
      body: c.body,
      sources: JSON.stringify(c.sources ?? []),
      related: JSON.stringify(c.related ?? []),
      categories: JSON.stringify(c.categories ?? []),
      category_keys: JSON.stringify(c.categoryKeys ?? []),
      created_at: c.createdAt,
      updated_at: updatedAt,
      version: c.version ?? 1,
    });
    noteCategoryKeysOnWrite(c.categoryKeys);
    recordSyncChange('concept', c.id, 'upsert', updatedAt);
  },

  getConcept(id: string): Concept | null {
    const row = cachedPrepare(`SELECT * FROM concepts WHERE id = ?`).get(id) as
      | ConceptRow
      | undefined;
    return row ? rowToConcept(row) : null;
  },

  listConcepts(options: RecordQueryOptions = {}): Concept[] {
    const { clause, params } = buildTimeWindowClause('updated_at', options);
    const { clause: limitClause, params: limitParams } = buildLimitClause(options);
    const rows = getServerDb()
      .prepare(
        `SELECT ${selectConceptColumns(options.summariesOnly)} FROM concepts ${clause} ORDER BY updated_at DESC${limitClause}`,
      )
      .all(...params, ...limitParams) as ConceptRow[];
    return rows.map((row) => rowToConcept(row, options.summariesOnly ? 'partial' : 'full'));
  },

  countConcepts(options: TimeWindowOptions = {}): number {
    const { clause, params } = buildTimeWindowClause('updated_at', options);
    const row = cachedPrepare(`SELECT COUNT(*) AS count FROM concepts ${clause}`).get(...params) as
      | { count: number }
      | undefined;
    return Number(row?.count ?? 0);
  },

  listConceptsBySourceId(sourceId: string, options: RecordQueryOptions = {}): Concept[] {
    if (!sourceId) return [];
    // Use json_each for exact matching instead of LIKE, which can produce
    // false positives when one sourceId is a substring of another.
    const clauses = [
      `EXISTS (SELECT 1 FROM json_each(concepts.sources) WHERE json_each.value = ?)`,
    ];
    const params: Array<string | number> = [sourceId];
    if (typeof options.after === 'number' && Number.isFinite(options.after)) {
      clauses.push('updated_at > ?');
      params.push(Math.trunc(options.after));
    }
    if (typeof options.before === 'number' && Number.isFinite(options.before)) {
      clauses.push('updated_at <= ?');
      params.push(Math.trunc(options.before));
    }
    const { clause: limitClause, params: limitParams } = buildLimitClause(options);
    const rows = getServerDb()
      .prepare(
        `SELECT ${selectConceptColumns(options.summariesOnly)}
           FROM concepts
          WHERE ${clauses.join(' AND ')}
          ORDER BY updated_at DESC${limitClause}`,
      )
      .all(...params, ...limitParams) as ConceptRow[];
    return rows.map((row) => rowToConcept(row, options.summariesOnly ? 'partial' : 'full'));
  },

  getConceptsByIds(ids: string[], options: { summariesOnly?: boolean } = {}): Concept[] {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = getServerDb()
      .prepare(
        `SELECT ${selectConceptColumns(options.summariesOnly)} FROM concepts WHERE id IN (${placeholders})`,
      )
      .all(...uniqueIds) as ConceptRow[];
    const rowMap = mapRowsById(
      rows.map((row) => rowToConcept(row, options.summariesOnly ? 'partial' : 'full')),
    );
    return uniqueIds.map((id) => rowMap.get(id)).filter((row): row is Concept => Boolean(row));
  },

  findConceptByTitleCI(title: string): Concept | null {
    const row = cachedPrepare(`SELECT * FROM concepts WHERE LOWER(title) = LOWER(?)`).get(title) as
      | ConceptRow
      | undefined;
    return row ? rowToConcept(row) : null;
  },

  replaceSourceIdInConcepts(
    oldSourceId: string,
    newSourceId: string,
    updatedAt = Date.now(),
  ): number {
    if (!oldSourceId || !newSourceId || oldSourceId === newSourceId) return 0;

    const db = getServerDb();
    const rows = db
      .prepare(`SELECT * FROM concepts WHERE sources LIKE ? ESCAPE '\\'`)
      .all(jsonArrayValueLikePattern(oldSourceId)) as ConceptRow[];

    let changed = 0;
    db.transaction(() => {
      for (const row of rows) {
        const concept = rowToConcept(row);
        if (!concept.sources.includes(oldSourceId)) continue;
        const nextSources = Array.from(
          new Set(
            concept.sources.map((sourceId) => (sourceId === oldSourceId ? newSourceId : sourceId)),
          ),
        );
        if (
          nextSources.length === concept.sources.length &&
          nextSources.every((sourceId, index) => sourceId === concept.sources[index])
        ) {
          continue;
        }
        repo.upsertConcept({
          ...concept,
          sources: nextSources,
          updatedAt,
        });
        changed += 1;
      }
    })();

    return changed;
  },

  listCategoryKeys(): string[] {
    if (_categoryKeysCache && Date.now() - _categoryKeysCache.ts < CATEGORY_CACHE_TTL) {
      return _categoryKeysCache.keys;
    }
    const rows = getServerDb().prepare(`SELECT category_keys FROM concepts`).all() as Array<{
      category_keys: string;
    }>;
    const result = normalizeCategoryState({
      categoryKeys: rows.flatMap((row) => parseJsonArray<string>(row.category_keys)),
    }).categoryKeys;
    _categoryKeysCache = { keys: result, ts: Date.now() };
    return result;
  },

  /**
   * Delete a concept row and best-effort clean associated auxiliary tables.
   * Tables created lazily by `wiki-db.ts` (concept_fts/concept_evidence/…) may
   * not exist yet in a cold database, so we swallow "no such table" errors.
   */
  deleteConcept(id: string): void {
    if (!id) return;
    const db = getServerDb();
    const safeExec = (sql: string, params: unknown[] = []) => {
      try {
        db.prepare(sql).run(...params);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/no such table/i.test(msg)) throw err;
      }
    };
    db.transaction(() => {
      db.prepare(`DELETE FROM concepts WHERE id = ?`).run(id);
      safeExec(`DELETE FROM concept_fts WHERE concept_id = ?`, [id]);
      safeExec(`DELETE FROM concept_evidence WHERE concept_id = ?`, [id]);
      safeExec(
        `DELETE FROM concept_relations WHERE source_concept_id = ? OR target_concept_id = ?`,
        [id, id],
      );
      safeExec(`DELETE FROM concept_versions WHERE concept_id = ?`, [id]);
      recordSyncChange('concept', id, 'delete');
    })();
    invalidateCategoryKeysCache();
  },

  /**
   * In every concept's `related` array, replace occurrences of `oldId` with
   * `newId` (or remove entirely when `newId` is null) and self-filter to avoid
   * a concept pointing to itself. Returns the number of rows modified.
   */
  replaceRelatedId(oldId: string, newId: string | null, updatedAt = Date.now()): number {
    if (!oldId) return 0;
    const db = getServerDb();
    const rows = db
      .prepare(`SELECT * FROM concepts WHERE related LIKE ? ESCAPE '\\'`)
      .all(jsonArrayValueLikePattern(oldId)) as ConceptRow[];
    let changed = 0;
    db.transaction(() => {
      for (const row of rows) {
        const concept = rowToConcept(row);
        if (!concept.related.includes(oldId)) continue;
        const mapped = concept.related
          .map((id) => (id === oldId ? newId : id))
          .filter((id): id is string => Boolean(id) && id !== concept.id);
        const nextRelated = Array.from(new Set(mapped));
        const unchanged =
          nextRelated.length === concept.related.length &&
          nextRelated.every((value, index) => value === concept.related[index]);
        if (unchanged) continue;
        repo.upsertConcept({ ...concept, related: nextRelated, updatedAt });
        changed += 1;
      }
    })();
    return changed;
  },

  findConceptCandidates(searchText: string, limit: number = 240): Concept[] {
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    const directMatches = findDirectTitleMentionConcepts(searchText, normalizedLimit);
    const keywords = Array.from(
      new Set(
        searchText
          .toLowerCase()
          .split(/[^a-z0-9\u4e00-\u9fff]+/i)
          .map((part) => part.trim())
          .filter((part) => part.length >= 2),
      ),
    ).slice(0, 12);

    if (keywords.length === 0) {
      if (directMatches.length > 0) return directMatches;
      return repo.listConcepts({ summariesOnly: true, limit: normalizedLimit });
    }

    // --- FTS5 fast path (concept_fts created lazily by wiki-db.ts) ---
    const ftsQuery = keywords.map((k) => `"${k.replace(/"/g, '')}"`).join(' OR ');
    if (ftsQuery) {
      try {
        const ftsRows = getServerDb()
          .prepare(
            `SELECT concept_id FROM concept_fts WHERE concept_fts MATCH ? ORDER BY bm25(concept_fts) LIMIT ?`,
          )
          .all(ftsQuery, normalizedLimit) as Array<{ concept_id: string }>;
        if (ftsRows.length > 0) {
          const matched = repo.getConceptsByIds(
            ftsRows.map((r) => r.concept_id),
            { summariesOnly: true },
          );
          const candidates = mergeConceptCandidateLists([directMatches, matched], normalizedLimit);
          if (candidates.length >= Math.min(normalizedLimit, 80)) {
            return candidates;
          }
          // Pad with recent concepts when FTS results are insufficient
          const existingIds = new Set(candidates.map((c) => c.id));
          const fallback = repo
            .listConcepts({ summariesOnly: true, limit: normalizedLimit * 2 })
            .filter((c) => !existingIds.has(c.id));
          return mergeConceptCandidateLists([candidates, fallback], normalizedLimit);
        }
      } catch {
        // concept_fts table missing or FTS5 unavailable – fall through to LIKE
      }
    }

    // --- LIKE fallback ---
    const queryParts = keywords.map(
      () => `(title LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE)`,
    );
    const queryParams = keywords.flatMap((keyword) => [`%${keyword}%`, `%${keyword}%`]);

    const matchedRows = getServerDb()
      .prepare(
        `SELECT ${selectConceptColumns(true)}
         FROM concepts
         WHERE ${queryParts.join(' OR ')}
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(...queryParams, normalizedLimit) as ConceptRow[];

    const matched = matchedRows.map((row) => rowToConcept(row, 'partial'));
    const candidates = mergeConceptCandidateLists([directMatches, matched], normalizedLimit);
    if (candidates.length >= Math.min(normalizedLimit, 80)) {
      return candidates;
    }

    const existingIds = new Set(candidates.map((concept) => concept.id));
    const fallback = repo
      .listConcepts({
        summariesOnly: true,
        limit: normalizedLimit * 2,
      })
      .filter((concept) => !existingIds.has(concept.id));

    return mergeConceptCandidateLists([candidates, fallback], normalizedLimit);
  },

  // ---- activity --------------------------------------------------
  insertActivity(a: ActivityLog): void {
    cachedPrepare(
      `INSERT OR REPLACE INTO activity
          (id, type, title, details, source_ids, concept_ids, at)
          VALUES (@id, @type, @title, @details, @source_ids, @concept_ids, @at)`,
    ).run({
      id: a.id,
      type: a.type,
      title: a.title,
      details: a.details ?? null,
      source_ids: JSON.stringify(a.relatedSourceIds ?? []),
      concept_ids: JSON.stringify(a.relatedConceptIds ?? []),
      at: a.at,
    });
    recordSyncChange('activity', a.id, 'upsert', a.at);
  },

  getActivityByIds(ids: string[]): ActivityLog[] {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = getServerDb()
      .prepare(`SELECT * FROM activity WHERE id IN (${placeholders})`)
      .all(...uniqueIds) as ActivityRow[];
    const rowMap = mapRowsById(rows.map(rowToActivity));
    return uniqueIds.map((id) => rowMap.get(id)).filter((row): row is ActivityLog => Boolean(row));
  },

  listActivity(limitOrOptions: number | TimeWindowWithLimit = 500): ActivityLog[] {
    const options = typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;
    const { clause, params } = buildTimeWindowClause('at', options);
    const hasLimit = typeof options.limit === 'number' && Number.isFinite(options.limit);
    const rows = getServerDb()
      .prepare(`SELECT * FROM activity ${clause} ORDER BY at DESC${hasLimit ? ' LIMIT ?' : ''}`)
      .all(...(hasLimit ? [...params, Math.trunc(options.limit!)] : params)) as ActivityRow[];
    return rows.map(rowToActivity);
  },

  // ---- ask history -----------------------------------------------
  listAskHistory(limitOrOptions: number | TimeWindowWithLimit = 200): AskMessage[] {
    const options = typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;
    const { clause, params } = buildTimeWindowClause('at', options);
    const hasLimit = typeof options.limit === 'number' && Number.isFinite(options.limit);
    const rows = getServerDb()
      .prepare(`SELECT * FROM ask_history ${clause} ORDER BY at DESC${hasLimit ? ' LIMIT ?' : ''}`)
      .all(...(hasLimit ? [...params, Math.trunc(options.limit!)] : params)) as AskRow[];
    return rows.map(rowToAsk);
  },

  getAskHistoryByIds(ids: string[]): AskMessage[] {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = getServerDb()
      .prepare(`SELECT * FROM ask_history WHERE id IN (${placeholders})`)
      .all(...uniqueIds) as AskRow[];
    const rowMap = mapRowsById(rows.map(rowToAsk));
    return uniqueIds.map((id) => rowMap.get(id)).filter((row): row is AskMessage => Boolean(row));
  },

  // ---- sync jobs -------------------------------------------------
  /** Returns the active (running) job if any. */
  getActiveSyncJob(): SyncJobRow | null {
    const row = cachedPrepare(`SELECT * FROM sync_jobs WHERE status = 'running' LIMIT 1`).get() as
      | SyncJobRow
      | undefined;
    return row ?? null;
  },

  /**
   * Recover jobs that are stuck in "running" state. This happens when the
   * server restarts mid-sync — the fire-and-forget Promise dies, but the DB
   * row stays `running` forever. Called on every sync start.
   *
   * @param maxAgeMs - Mark running jobs older than this as failed. Default 10 min.
   * @returns Number of jobs recovered.
   */
  recoverStaleSyncJobs(maxAgeMs: number = 10 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    // A job is "alive" if its heartbeat is fresh. Fall back to started_at for
    // pre-migration rows. Long-running LLM pipelines that bump heartbeat_at
    // every iteration survive this check even if total runtime exceeds 10min.
    const result = cachedPrepare(
      `UPDATE sync_jobs
         SET status = 'failed',
             error = COALESCE(error, '服务重启导致任务中断（已自动回收）'),
             finished_at = ?
         WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < ?`,
    ).run(Date.now(), cutoff);
    return result.changes;
  },

  getSyncJob(id: string): SyncJobRow | null {
    const row = cachedPrepare(`SELECT * FROM sync_jobs WHERE id = ?`).get(id) as
      | SyncJobRow
      | undefined;
    return row ?? null;
  },

  insertSyncJob(j: SyncJobRow): void {
    const row: SyncJobRow = { heartbeat_at: j.heartbeat_at ?? j.started_at, ...j };
    cachedPrepare(
      `INSERT INTO sync_jobs
          (id, kind, status, total, done, failed, current, log, error, started_at, finished_at, heartbeat_at)
          VALUES (@id, @kind, @status, @total, @done, @failed, @current, @log, @error, @started_at, @finished_at, @heartbeat_at)`,
    ).run(row);
  },

  updateSyncJob(id: string, patch: Partial<SyncJobRow>): boolean {
    const prev = repo.getSyncJob(id);
    if (!prev) return false;
    // Any update implicitly bumps heartbeat_at for running jobs unless caller
    // supplied an explicit value. Terminal status updates (done/failed) skip
    // the auto-bump to keep the final row immutable for audits.
    const autoHeartbeat =
      patch.heartbeat_at === undefined && (patch.status ?? prev.status) === 'running'
        ? Date.now()
        : (patch.heartbeat_at ?? prev.heartbeat_at ?? prev.started_at);
    const next: SyncJobRow = { ...prev, ...patch, heartbeat_at: autoHeartbeat };
    // Optimistic lock: only update if heartbeat_at hasn't changed since we read
    const prevHeartbeat = prev.heartbeat_at ?? prev.started_at;
    const result = cachedPrepare(
      `UPDATE sync_jobs SET
            status = @status, total = @total, done = @done, failed = @failed,
            current = @current, log = @log, error = @error, finished_at = @finished_at,
            heartbeat_at = @heartbeat_at
          WHERE id = @id AND (heartbeat_at = @prev_heartbeat OR (heartbeat_at IS NULL AND @prev_heartbeat = started_at))`,
    ).run({ ...next, prev_heartbeat: prevHeartbeat });
    return result.changes > 0;
  },

  // ---- category wiki -------------------------------------------
  listConceptsByCategory(primary: string, secondary: string, limit = 80): Concept[] {
    const rows = getServerDb()
      .prepare(
        `SELECT ${selectConceptColumns(true)}
         FROM concepts
         WHERE category_keys LIKE ? ESCAPE '\\'
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(jsonArrayValueLikePattern(`${primary}/${secondary}`), limit) as ConceptRow[];
    return rows.map((row) => rowToConcept(row, 'partial'));
  },

  getCategoryWiki(primary: string, secondary: string): CategoryWikiRow | null {
    const row = cachedPrepare(
      `SELECT * FROM category_wikis WHERE primary_category = ? AND secondary_category = ?`,
    ).get(primary, secondary) as CategoryWikiRow | undefined;
    return row ?? null;
  },

  upsertCategoryWiki(w: {
    id: string;
    primaryCategory: string;
    secondaryCategory: string;
    bodyMd: string;
    tocJson: string;
    conceptIds: string[];
    conceptIdsHash: string;
    model?: string;
    promptVersion?: string;
    generatedAt: number;
  }): void {
    cachedPrepare(
      `INSERT OR REPLACE INTO category_wikis
        (id, primary_category, secondary_category, body_md, toc_json, concept_ids, concept_ids_hash, model, prompt_version, generated_at, stale)
       VALUES (@id, @primary_category, @secondary_category, @body_md, @toc_json, @concept_ids, @concept_ids_hash, @model, @prompt_version, @generated_at, 0)`,
    ).run({
      id: w.id,
      primary_category: w.primaryCategory,
      secondary_category: w.secondaryCategory,
      body_md: w.bodyMd,
      toc_json: w.tocJson,
      concept_ids: JSON.stringify(w.conceptIds),
      concept_ids_hash: w.conceptIdsHash,
      model: w.model ?? null,
      prompt_version: w.promptVersion ?? null,
      generated_at: w.generatedAt,
    });
  },

  markCategoryWikisStale(pairs: Array<{ primary: string; secondary: string }>): number {
    if (pairs.length === 0) return 0;
    const conditions: string[] = [];
    const params: string[] = [];
    for (const pair of pairs) {
      conditions.push('(primary_category = ? AND secondary_category = ?)');
      params.push(pair.primary, pair.secondary);
    }
    const result = getServerDb()
      .prepare(`UPDATE category_wikis SET stale = 1 WHERE ${conditions.join(' OR ')}`)
      .run(...params);
    return result.changes;
  },
};

export interface CategoryWikiRow {
  id: string;
  primary_category: string;
  secondary_category: string;
  body_md: string;
  toc_json: string;
  concept_ids: string;
  concept_ids_hash: string;
  model: string | null;
  prompt_version: string | null;
  generated_at: number;
  stale: number;
}

export function rowToCategoryWiki(r: CategoryWikiRow): CategoryWiki {
  return {
    id: r.id,
    primaryCategory: r.primary_category,
    secondaryCategory: r.secondary_category,
    bodyMd: r.body_md,
    tocJson: r.toc_json,
    conceptIds: parseJsonArray<string>(r.concept_ids),
    conceptIdsHash: r.concept_ids_hash,
    model: r.model ?? undefined,
    promptVersion: r.prompt_version ?? undefined,
    generatedAt: r.generated_at,
    stale: Boolean(r.stale),
  };
}

export interface SyncJobRow {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  done: number;
  failed: number;
  current: string | null;
  log: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  /** Timestamp of the most recent progress update — used for zombie detection. */
  heartbeat_at?: number | null;
}
