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

import type {
  Source,
  Concept,
  ActivityLog,
  AskMessage,
  SourceType,
  ActivityType,
} from './types';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');

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

    CREATE TABLE IF NOT EXISTS meta (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);
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

function parseJsonArray<T>(s: string | null | undefined, fallback: T[] = []): T[] {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function rowToSource(r: SourceRow): Source {
  return {
    id: r.id,
    title: r.title,
    type: r.type as SourceType,
    author: r.author ?? undefined,
    url: r.url ?? undefined,
    rawContent: r.raw_content,
    ingestedAt: r.ingested_at,
    externalKey: r.external_key ?? undefined,
  };
}

function rowToConcept(r: ConceptRow): Concept {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    body: r.body,
    sources: parseJsonArray<string>(r.sources),
    related: parseJsonArray<string>(r.related),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    version: r.version,
  };
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
// Public repository API
// --------------------------------------------------------------------

export const repo = {
  // ---- sources ---------------------------------------------------
  insertSource(s: Source): void {
    getServerDb()
      .prepare(
        `INSERT OR REPLACE INTO sources
          (id, title, type, author, url, raw_content, ingested_at, external_key)
          VALUES (@id, @title, @type, @author, @url, @raw_content, @ingested_at, @external_key)`
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
    const row = getServerDb()
      .prepare(`SELECT * FROM sources WHERE external_key = ?`)
      .get(key) as SourceRow | undefined;
    return row ? rowToSource(row) : null;
  },

  deleteSource(id: string): void {
    getServerDb().prepare(`DELETE FROM sources WHERE id = ?`).run(id);
  },

  listSources(): Source[] {
    const rows = getServerDb()
      .prepare(`SELECT * FROM sources ORDER BY ingested_at DESC`)
      .all() as SourceRow[];
    return rows.map(rowToSource);
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
          (id, title, summary, body, sources, related, created_at, updated_at, version)
          VALUES (@id, @title, @summary, @body, @sources, @related, @created_at, @updated_at, @version)`
      )
      .run({
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: c.body,
        sources: JSON.stringify(c.sources ?? []),
        related: JSON.stringify(c.related ?? []),
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        version: c.version ?? 1,
      });
  },

  getConcept(id: string): Concept | null {
    const row = getServerDb().prepare(`SELECT * FROM concepts WHERE id = ?`).get(id) as
      | ConceptRow
      | undefined;
    return row ? rowToConcept(row) : null;
  },

  listConcepts(): Concept[] {
    const rows = getServerDb()
      .prepare(`SELECT * FROM concepts ORDER BY updated_at DESC`)
      .all() as ConceptRow[];
    return rows.map(rowToConcept);
  },

  findConceptByTitleCI(title: string): Concept | null {
    const row = getServerDb()
      .prepare(`SELECT * FROM concepts WHERE LOWER(title) = LOWER(?)`)
      .get(title) as ConceptRow | undefined;
    return row ? rowToConcept(row) : null;
  },

  // ---- activity --------------------------------------------------
  insertActivity(a: ActivityLog): void {
    getServerDb()
      .prepare(
        `INSERT OR REPLACE INTO activity
          (id, type, title, details, source_ids, concept_ids, at)
          VALUES (@id, @type, @title, @details, @source_ids, @concept_ids, @at)`
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

  listActivity(limit = 500): ActivityLog[] {
    const rows = getServerDb()
      .prepare(`SELECT * FROM activity ORDER BY at DESC LIMIT ?`)
      .all(limit) as ActivityRow[];
    return rows.map(rowToActivity);
  },

  // ---- ask history -----------------------------------------------
  listAskHistory(limit = 200): AskMessage[] {
    const rows = getServerDb()
      .prepare(`SELECT * FROM ask_history ORDER BY at DESC LIMIT ?`)
      .all(limit) as AskRow[];
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

  getSyncJob(id: string): SyncJobRow | null {
    const row = getServerDb().prepare(`SELECT * FROM sync_jobs WHERE id = ?`).get(id) as
      | SyncJobRow
      | undefined;
    return row ?? null;
  },

  insertSyncJob(j: SyncJobRow): void {
    getServerDb()
      .prepare(
        `INSERT INTO sync_jobs
          (id, kind, status, total, done, failed, current, log, error, started_at, finished_at)
          VALUES (@id, @kind, @status, @total, @done, @failed, @current, @log, @error, @started_at, @finished_at)`
      )
      .run(j);
  },

  updateSyncJob(id: string, patch: Partial<SyncJobRow>): void {
    const prev = this.getSyncJob(id);
    if (!prev) return;
    const next = { ...prev, ...patch };
    getServerDb()
      .prepare(
        `UPDATE sync_jobs SET
            status = @status, total = @total, done = @done, failed = @failed,
            current = @current, log = @log, error = @error, finished_at = @finished_at
          WHERE id = @id`
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
}
