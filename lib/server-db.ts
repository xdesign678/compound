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

import Database, { type Database as DB } from 'better-sqlite3';
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
  db.pragma('busy_timeout = 3000');

  runMigrations(db);
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

export function getServerDbPath(): string {
  return getHolder().path;
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
      external_key  TEXT
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

  runCategoryNormalizationIfNeeded(db);
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
  external_key: string | null;
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
    contentStatus,
    externalKey: r.external_key ?? undefined,
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
    ? `id, title, type, author, url, '' AS raw_content, ingested_at, external_key`
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

  const rows = getServerDb()
    .prepare(
      `SELECT ${selectConceptColumns(true)}
       FROM concepts
       WHERE length(trim(title)) >= ?
         AND instr(?, lower(title)) > 0
       ORDER BY length(title) DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(MIN_DIRECT_TITLE_MENTION_LENGTH, normalizedSearchText, limit) as ConceptRow[];

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

// --------------------------------------------------------------------
// Public repository API
// --------------------------------------------------------------------

export const repo = {
  // ---- sources ---------------------------------------------------
  insertSource(s: Source): void {
    getServerDb()
      .prepare(
        `INSERT OR REPLACE INTO sources
          (id, title, type, author, url, raw_content, ingested_at, external_key)
          VALUES (@id, @title, @type, @author, @url, @raw_content, @ingested_at, @external_key)`,
      )
      .run({
        id: s.id,
        title: s.title,
        type: s.type,
        author: s.author ?? null,
        url: s.url ?? null,
        raw_content: s.rawContent,
        ingested_at: s.ingestedAt,
        external_key: s.externalKey ?? null,
      });
  },

  getSource(id: string): Source | null {
    const row = getServerDb().prepare(`SELECT * FROM sources WHERE id = ?`).get(id) as
      | SourceRow
      | undefined;
    return row ? rowToSource(row) : null;
  },

  getSourceByExternalKey(key: string): Source | null {
    const row = getServerDb().prepare(`SELECT * FROM sources WHERE external_key = ?`).get(key) as
      | SourceRow
      | undefined;
    return row ? rowToSource(row) : null;
  },

  deleteSource(id: string): void {
    getServerDb().prepare(`DELETE FROM sources WHERE id = ?`).run(id);
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
  listGithubExternalKeys(): Array<{ id: string; externalKey: string }> {
    const rows = getServerDb()
      .prepare(`SELECT id, external_key FROM sources WHERE external_key LIKE 'github:%'`)
      .all() as Array<{ id: string; external_key: string }>;
    return rows.map((r) => ({ id: r.id, externalKey: r.external_key }));
  },

  // ---- concepts --------------------------------------------------
  upsertConcept(c: Concept): void {
    getServerDb()
      .prepare(
        `INSERT OR REPLACE INTO concepts
          (id, title, summary, body, sources, related, categories, category_keys, created_at, updated_at, version)
          VALUES (@id, @title, @summary, @body, @sources, @related, @categories, @category_keys, @created_at, @updated_at, @version)`,
      )
      .run({
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: c.body,
        sources: JSON.stringify(c.sources ?? []),
        related: JSON.stringify(c.related ?? []),
        categories: JSON.stringify(c.categories ?? []),
        category_keys: JSON.stringify(c.categoryKeys ?? []),
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        version: c.version ?? 1,
      });
    invalidateCategoryKeysCache();
  },

  getConcept(id: string): Concept | null {
    const row = getServerDb().prepare(`SELECT * FROM concepts WHERE id = ?`).get(id) as
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
    const row = getServerDb()
      .prepare(`SELECT * FROM concepts WHERE LOWER(title) = LOWER(?)`)
      .get(title) as ConceptRow | undefined;
    return row ? rowToConcept(row) : null;
  },

  replaceSourceIdInConcepts(
    oldSourceId: string,
    newSourceId: string,
    updatedAt = Date.now(),
  ): number {
    if (!oldSourceId || !newSourceId || oldSourceId === newSourceId) return 0;

    const rows = getServerDb()
      .prepare(`SELECT * FROM concepts WHERE sources LIKE ? ESCAPE '\\'`)
      .all(jsonArrayValueLikePattern(oldSourceId)) as ConceptRow[];

    let changed = 0;
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
    db.prepare(`DELETE FROM concepts WHERE id = ?`).run(id);
    safeExec(`DELETE FROM concept_fts WHERE concept_id = ?`, [id]);
    safeExec(`DELETE FROM concept_evidence WHERE concept_id = ?`, [id]);
    safeExec(`DELETE FROM concept_relations WHERE source_concept_id = ? OR target_concept_id = ?`, [
      id,
      id,
    ]);
    safeExec(`DELETE FROM concept_versions WHERE concept_id = ?`, [id]);
    invalidateCategoryKeysCache();
  },

  /**
   * In every concept's `related` array, replace occurrences of `oldId` with
   * `newId` (or remove entirely when `newId` is null) and self-filter to avoid
   * a concept pointing to itself. Returns the number of rows modified.
   */
  replaceRelatedId(oldId: string, newId: string | null, updatedAt = Date.now()): number {
    if (!oldId) return 0;
    const rows = getServerDb()
      .prepare(`SELECT * FROM concepts WHERE related LIKE ? ESCAPE '\\'`)
      .all(jsonArrayValueLikePattern(oldId)) as ConceptRow[];
    let changed = 0;
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
    getServerDb()
      .prepare(
        `INSERT OR REPLACE INTO activity
          (id, type, title, details, source_ids, concept_ids, at)
          VALUES (@id, @type, @title, @details, @source_ids, @concept_ids, @at)`,
      )
      .run({
        id: a.id,
        type: a.type,
        title: a.title,
        details: a.details ?? null,
        source_ids: JSON.stringify(a.relatedSourceIds ?? []),
        concept_ids: JSON.stringify(a.relatedConceptIds ?? []),
        at: a.at,
      });
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

  // ---- sync jobs -------------------------------------------------
  /** Returns the active (running) job if any. */
  getActiveSyncJob(): SyncJobRow | null {
    const row = getServerDb()
      .prepare(`SELECT * FROM sync_jobs WHERE status = 'running' LIMIT 1`)
      .get() as SyncJobRow | undefined;
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
    const result = getServerDb()
      .prepare(
        `UPDATE sync_jobs
         SET status = 'failed',
             error = COALESCE(error, '服务重启导致任务中断（已自动回收）'),
             finished_at = ?
         WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < ?`,
      )
      .run(Date.now(), cutoff);
    return result.changes;
  },

  getSyncJob(id: string): SyncJobRow | null {
    const row = getServerDb().prepare(`SELECT * FROM sync_jobs WHERE id = ?`).get(id) as
      | SyncJobRow
      | undefined;
    return row ?? null;
  },

  insertSyncJob(j: SyncJobRow): void {
    const row: SyncJobRow = { heartbeat_at: j.heartbeat_at ?? j.started_at, ...j };
    getServerDb()
      .prepare(
        `INSERT INTO sync_jobs
          (id, kind, status, total, done, failed, current, log, error, started_at, finished_at, heartbeat_at)
          VALUES (@id, @kind, @status, @total, @done, @failed, @current, @log, @error, @started_at, @finished_at, @heartbeat_at)`,
      )
      .run(row);
  },

  updateSyncJob(id: string, patch: Partial<SyncJobRow>): void {
    const prev = repo.getSyncJob(id);
    if (!prev) return;
    // Any update implicitly bumps heartbeat_at for running jobs unless caller
    // supplied an explicit value. Terminal status updates (done/failed) skip
    // the auto-bump to keep the final row immutable for audits.
    const autoHeartbeat =
      patch.heartbeat_at === undefined && (patch.status ?? prev.status) === 'running'
        ? Date.now()
        : (patch.heartbeat_at ?? prev.heartbeat_at ?? prev.started_at);
    const next: SyncJobRow = { ...prev, ...patch, heartbeat_at: autoHeartbeat };
    getServerDb()
      .prepare(
        `UPDATE sync_jobs SET
            status = @status, total = @total, done = @done, failed = @failed,
            current = @current, log = @log, error = @error, finished_at = @finished_at,
            heartbeat_at = @heartbeat_at
          WHERE id = @id`,
      )
      .run(next);
  },
};

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
