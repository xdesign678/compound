/**
 * Server-side N+1 query detection and SQL execution analyzer for `better-sqlite3`.
 *
 * Compound persists everything (concepts, sources, ask history, sync jobs,
 * wiki indexes) to a single SQLite database accessed through raw
 * `better-sqlite3` prepared statements. With no ORM or `DataLoader`-style
 * batching layer in front of the driver, it is easy to introduce an "N+1"
 * pattern accidentally — for example a loop that fetches each concept by id
 * one at a time after listing them.
 *
 * This module provides:
 *
 *   1. {@link fingerprintSql} — normalizes a SQL string by stripping comments,
 *      collapsing whitespace and replacing literals with `?` so semantically
 *      identical statements share a fingerprint.
 *
 *   2. {@link runWithQueryScope} — opens an `AsyncLocalStorage` scope (one per
 *      HTTP request, sync run, or test) inside which every prepared statement
 *      execution is counted by fingerprint.
 *
 *   3. {@link instrumentDatabase} — wraps `Database.prepare` so every
 *      `Statement.run / get / all / iterate` call automatically records its
 *      fingerprint, duration and success state into the active scope.
 *
 *   4. {@link finishQueryScope} — flushes the scope, logging an
 *      `db.n_plus_one_detected` structured warning per fingerprint that
 *      exceeded {@link DEFAULT_N_PLUS_ONE_THRESHOLD}, and updating the
 *      process-wide counters consumed by the Prometheus exporter.
 *
 * Server-only. Do not import from client code: it depends on
 * `node:async_hooks` and `node:perf_hooks`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

import type { Database as DB, Statement } from 'better-sqlite3';

import { logger } from '../logging';
import { reportError } from './sentry';

const SQL_COMMENT_LINE_RE = /--[^\n]*/g;
const SQL_COMMENT_BLOCK_RE = /\/\*[\s\S]*?\*\//g;
const SQL_STRING_LITERAL_RE = /'(?:[^']|'')*'/g;
const SQL_DOUBLE_QUOTED_RE = /"(?:[^"]|"")*"/g;
const SQL_NUMERIC_LITERAL_RE = /\b\d+(?:\.\d+)?\b/g;
const SQL_PLACEHOLDER_RE = /\?\d*|@\w+|:\w+|\$\w+/g;
const SQL_WHITESPACE_RE = /\s+/g;

const N_PLUS_ONE_ENV_KEY = 'COMPOUND_N_PLUS_ONE_THRESHOLD';
const SLOW_QUERY_ENV_KEY = 'COMPOUND_SLOW_QUERY_MS';
const SLOW_QUERY_SENTRY_ENV_KEY = 'COMPOUND_SLOW_QUERY_SENTRY_MS';
const ANALYZER_DISABLED_ENV_KEY = 'COMPOUND_DISABLE_QUERY_ANALYZER';

/** Default count above which repeated identical queries become an N+1 warning. */
export const DEFAULT_N_PLUS_ONE_THRESHOLD = 10;

/** Default duration above which a single query is logged as slow. */
export const DEFAULT_SLOW_QUERY_MS = 50;

/**
 * Duration above which a slow query is escalated to Sentry as a warning event
 * (not just a log line). This threshold is intentionally much higher than the
 * log threshold to avoid flooding Sentry with low-signal noise; only the
 * obviously pathological queries (>500ms) land as distinct events.
 */
export const DEFAULT_SLOW_QUERY_SENTRY_MS = 500;

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Threshold for the per-scope N+1 warning. Configurable via
 * `COMPOUND_N_PLUS_ONE_THRESHOLD`.
 */
export function getNPlusOneThreshold(): number {
  return readNumberEnv(N_PLUS_ONE_ENV_KEY, DEFAULT_N_PLUS_ONE_THRESHOLD);
}

/** Slow-query duration (ms). Configurable via `COMPOUND_SLOW_QUERY_MS`. */
export function getSlowQueryThresholdMs(): number {
  return readNumberEnv(SLOW_QUERY_ENV_KEY, DEFAULT_SLOW_QUERY_MS);
}

/**
 * Slow-query threshold for Sentry escalation. Queries above the log threshold
 * but below this value stay in NDJSON logs only; queries above this value also
 * emit a Sentry warning event for incident triage. Configurable via
 * `COMPOUND_SLOW_QUERY_SENTRY_MS`.
 */
export function getSlowQuerySentryThresholdMs(): number {
  return readNumberEnv(SLOW_QUERY_SENTRY_ENV_KEY, DEFAULT_SLOW_QUERY_SENTRY_MS);
}

function isAnalyzerDisabled(): boolean {
  const raw = process.env[ANALYZER_DISABLED_ENV_KEY];
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * Normalize a SQL statement so semantically identical queries share a key.
 *
 * - Strips line and block comments.
 * - Replaces string and numeric literals with `?`.
 * - Replaces `@name` / `:name` / `$name` / `?N` placeholders with `?`.
 * - Lower-cases the result and collapses whitespace.
 *
 * The fingerprint is intentionally lossy: `SELECT * FROM x WHERE id = 1` and
 * `SELECT  *  FROM  x  WHERE  id = 'abc'` map to the same key. This makes it
 * useful as a counter dimension without leaking row-level data into logs.
 */
export function fingerprintSql(sql: string): string {
  return sql
    .replace(SQL_COMMENT_LINE_RE, ' ')
    .replace(SQL_COMMENT_BLOCK_RE, ' ')
    .replace(SQL_STRING_LITERAL_RE, '?')
    .replace(SQL_DOUBLE_QUOTED_RE, '?')
    .replace(SQL_PLACEHOLDER_RE, '?')
    .replace(SQL_NUMERIC_LITERAL_RE, '?')
    .replace(SQL_WHITESPACE_RE, ' ')
    .trim()
    .toLowerCase();
}

export interface QueryFingerprintStats {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
  errorCount: number;
  /** First raw SQL seen for this fingerprint — useful for log readability. */
  sample: string;
}

export interface QueryScope {
  id: string;
  label?: string;
  startedAt: number;
  fingerprints: Map<string, QueryFingerprintStats>;
  /** Fingerprints that crossed the N+1 threshold during this scope. */
  warned: Set<string>;
}

export interface QueryExecution {
  fingerprint: string;
  sql: string;
  durationMs: number;
  success: boolean;
}

export interface NPlusOneWarning {
  fingerprint: string;
  count: number;
  totalDurationMs: number;
  sample: string;
  scopeLabel?: string;
}

export interface QueryScopeSummary {
  scopeId: string;
  label?: string;
  durationMs: number;
  totalQueries: number;
  uniqueFingerprints: number;
  errorCount: number;
  topFingerprints: Array<QueryFingerprintStats & { fingerprint: string }>;
  warnings: NPlusOneWarning[];
}

const scopeStorage = new AsyncLocalStorage<QueryScope>();

function newScopeId(): string {
  return `qs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Returns the active query scope, if any. */
export function getQueryScope(): QueryScope | undefined {
  return scopeStorage.getStore();
}

export interface RunWithQueryScopeOptions {
  /** Free-form label used in summary logs. */
  label?: string;
  /** Optional pre-existing scope id to make logs deterministic in tests. */
  scopeId?: string;
}

/**
 * Run `fn` with a fresh query scope. When `fn` resolves the scope is finished
 * automatically: a structured summary is logged and any N+1 warnings are
 * emitted.
 */
export function runWithQueryScope<T>(
  fn: () => T | Promise<T>,
  options: RunWithQueryScopeOptions = {},
): Promise<T> {
  const scope = createQueryScope(options);
  return scopeStorage.run(scope, async () => {
    try {
      return await fn();
    } finally {
      finishQueryScope(scope);
    }
  });
}

/** Lower-level helper used by request handlers that want to manage the scope. */
export function createQueryScope(options: RunWithQueryScopeOptions = {}): QueryScope {
  return {
    id: options.scopeId ?? newScopeId(),
    label: options.label,
    startedAt: performance.now(),
    fingerprints: new Map(),
    warned: new Set(),
  };
}

/**
 * Run `fn` while an externally-created scope is bound to the AsyncLocalStorage.
 * Useful when the caller (e.g. `withRequestTracing`) wants to call
 * {@link finishQueryScope} itself in a `finally` block alongside other
 * teardown logic.
 */
export function runWithExistingQueryScope<T>(
  scope: QueryScope,
  fn: () => T | Promise<T>,
): Promise<T> {
  return scopeStorage.run(scope, async () => fn());
}

interface GlobalQueryMetrics {
  totalQueries: number;
  totalErrors: number;
  totalDurationMs: number;
  maxDurationMs: number;
  totalNPlusOneIncidents: number;
  fingerprintNPlusOneIncidents: Map<string, number>;
  topFingerprintCounts: Map<string, number>;
}

const globalMetrics: GlobalQueryMetrics = {
  totalQueries: 0,
  totalErrors: 0,
  totalDurationMs: 0,
  maxDurationMs: 0,
  totalNPlusOneIncidents: 0,
  fingerprintNPlusOneIncidents: new Map(),
  topFingerprintCounts: new Map(),
};

const TOP_FINGERPRINT_TRACK_LIMIT = 64;

function trackTopFingerprint(fingerprint: string): void {
  const next = (globalMetrics.topFingerprintCounts.get(fingerprint) ?? 0) + 1;
  globalMetrics.topFingerprintCounts.set(fingerprint, next);
  if (globalMetrics.topFingerprintCounts.size <= TOP_FINGERPRINT_TRACK_LIMIT) return;
  let evictKey: string | null = null;
  let evictCount = Infinity;
  for (const [key, value] of globalMetrics.topFingerprintCounts) {
    if (value < evictCount) {
      evictCount = value;
      evictKey = key;
    }
  }
  if (evictKey !== null && evictKey !== fingerprint) {
    globalMetrics.topFingerprintCounts.delete(evictKey);
  }
}

/** Reset all process-wide metrics. Intended for tests. */
export function resetQueryAnalyzerForTests(): void {
  globalMetrics.totalQueries = 0;
  globalMetrics.totalErrors = 0;
  globalMetrics.totalDurationMs = 0;
  globalMetrics.maxDurationMs = 0;
  globalMetrics.totalNPlusOneIncidents = 0;
  globalMetrics.fingerprintNPlusOneIncidents.clear();
  globalMetrics.topFingerprintCounts.clear();
}

export interface QueryAnalyzerMetricsSnapshot {
  totalQueries: number;
  totalErrors: number;
  totalDurationMs: number;
  maxDurationMs: number;
  totalNPlusOneIncidents: number;
  topFingerprints: Array<{ fingerprint: string; count: number }>;
  worstNPlusOneFingerprints: Array<{ fingerprint: string; incidents: number }>;
}

/** Snapshot used by the Prometheus exporter and `/api/metrics` callers. */
export function getQueryAnalyzerSnapshot(limit = 10): QueryAnalyzerMetricsSnapshot {
  const top = Array.from(globalMetrics.topFingerprintCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, limit))
    .map(([fingerprint, count]) => ({ fingerprint, count }));
  const worst = Array.from(globalMetrics.fingerprintNPlusOneIncidents.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, limit))
    .map(([fingerprint, incidents]) => ({ fingerprint, incidents }));
  return {
    totalQueries: globalMetrics.totalQueries,
    totalErrors: globalMetrics.totalErrors,
    totalDurationMs: globalMetrics.totalDurationMs,
    maxDurationMs: globalMetrics.maxDurationMs,
    totalNPlusOneIncidents: globalMetrics.totalNPlusOneIncidents,
    topFingerprints: top,
    worstNPlusOneFingerprints: worst,
  };
}

function trimSql(sql: string): string {
  const compact = sql.replace(SQL_WHITESPACE_RE, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 240)}…` : compact;
}

/**
 * Record one query execution. Called automatically by the
 * {@link instrumentDatabase} wrapper, but also exposed so unit tests and
 * non-better-sqlite3 callers can integrate.
 */
export function recordQueryExecution(event: QueryExecution): void {
  globalMetrics.totalQueries += 1;
  globalMetrics.totalDurationMs += Math.max(0, event.durationMs);
  if (event.durationMs > globalMetrics.maxDurationMs) {
    globalMetrics.maxDurationMs = event.durationMs;
  }
  if (!event.success) globalMetrics.totalErrors += 1;
  trackTopFingerprint(event.fingerprint);

  const slowThreshold = getSlowQueryThresholdMs();
  if (event.durationMs >= slowThreshold) {
    const sample = trimSql(event.sql);
    logger.warn('db.slow_query', {
      fingerprint: event.fingerprint,
      durationMs: Math.round(event.durationMs),
      sample,
    });
    // Escalate the pathologically-slow subset to Sentry so it shows up in
    // incident dashboards. The fingerprint is used as the Sentry fingerprint
    // so repeated incidents of the same query collapse into one issue instead
    // of spawning a new one per request.
    const sentryThreshold = getSlowQuerySentryThresholdMs();
    if (event.durationMs >= sentryThreshold) {
      reportError(new Error(`db.slow_query ${Math.round(event.durationMs)}ms: ${sample}`), {
        level: 'warning',
        tags: { area: 'db', slow: 'true' },
        extras: {
          fingerprint: event.fingerprint,
          durationMs: Math.round(event.durationMs),
          thresholdMs: sentryThreshold,
          sample,
        },
        fingerprint: ['db.slow_query', event.fingerprint],
      });
    }
  }

  const scope = scopeStorage.getStore();
  if (!scope) return;
  const stats = scope.fingerprints.get(event.fingerprint) ?? {
    count: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    errorCount: 0,
    sample: event.sql,
  };
  stats.count += 1;
  stats.totalDurationMs += Math.max(0, event.durationMs);
  if (event.durationMs > stats.maxDurationMs) stats.maxDurationMs = event.durationMs;
  if (!event.success) stats.errorCount += 1;
  scope.fingerprints.set(event.fingerprint, stats);

  const threshold = getNPlusOneThreshold();
  if (stats.count === threshold && !scope.warned.has(event.fingerprint)) {
    scope.warned.add(event.fingerprint);
    globalMetrics.totalNPlusOneIncidents += 1;
    globalMetrics.fingerprintNPlusOneIncidents.set(
      event.fingerprint,
      (globalMetrics.fingerprintNPlusOneIncidents.get(event.fingerprint) ?? 0) + 1,
    );
    logger.warn('db.n_plus_one_detected', {
      fingerprint: event.fingerprint,
      count: stats.count,
      threshold,
      scopeId: scope.id,
      scopeLabel: scope.label,
      sample: trimSql(stats.sample),
      hint: 'Replace the per-row query with a batched IN (...) lookup or a JOIN. See runbooks/n-plus-one-queries.md.',
    });
  }
}

const STATEMENT_EXECUTING_METHODS: ReadonlySet<string> = new Set(['run', 'get', 'all', 'iterate']);

const STATEMENT_CHAINABLE_METHODS: ReadonlySet<string> = new Set([
  'pluck',
  'expand',
  'raw',
  'safeIntegers',
  'bind',
  'columns',
]);

const INSTRUMENTED_SYMBOL = Symbol.for('compound.queryAnalyzer.instrumented');

/**
 * Wrap `db.prepare` so every prepared statement records its execution into the
 * active query scope. Calling more than once on the same Database instance is
 * a no-op.
 */
export function instrumentDatabase(db: DB): DB {
  if (isAnalyzerDisabled()) return db;
  const flagged = db as DB & { [INSTRUMENTED_SYMBOL]?: boolean };
  if (flagged[INSTRUMENTED_SYMBOL]) return db;
  flagged[INSTRUMENTED_SYMBOL] = true;

  const originalPrepare = db.prepare.bind(db) as (sql: string) => Statement;
  (db as unknown as { prepare: (sql: string) => Statement }).prepare = function patchedPrepare(
    sql: string,
  ) {
    const stmt = originalPrepare(sql);
    const fingerprint = fingerprintSql(sql);
    return wrapStatement(stmt, sql, fingerprint);
  };
  return db;
}

function wrapStatement<S extends Statement>(stmt: S, sql: string, fingerprint: string): S {
  const proxy = new Proxy(stmt, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (typeof prop === 'string' && STATEMENT_EXECUTING_METHODS.has(prop)) {
        return function instrumentedRun(...args: unknown[]) {
          const start = performance.now();
          let success = false;
          try {
            const result = (value as (...callArgs: unknown[]) => unknown).apply(target, args);
            success = true;
            return result;
          } finally {
            recordQueryExecution({
              fingerprint,
              sql,
              durationMs: performance.now() - start,
              success,
            });
          }
        };
      }
      if (typeof prop === 'string' && STATEMENT_CHAINABLE_METHODS.has(prop)) {
        return function chainedCall(...args: unknown[]) {
          const result = (value as (...callArgs: unknown[]) => unknown).apply(target, args);
          if (result === target) return receiver;
          return result;
        };
      }
      return (value as (...callArgs: unknown[]) => unknown).bind(target);
    },
  });
  return proxy as S;
}

/**
 * Finish a query scope, emitting a summary log entry. Returns the structured
 * summary so callers (request handlers, scripts) can attach extra fields.
 */
export function finishQueryScope(scope: QueryScope): QueryScopeSummary {
  const durationMs = performance.now() - scope.startedAt;
  const top: Array<QueryFingerprintStats & { fingerprint: string }> = [];
  let totalQueries = 0;
  let errorCount = 0;
  for (const [fingerprint, stats] of scope.fingerprints) {
    totalQueries += stats.count;
    errorCount += stats.errorCount;
    top.push({ fingerprint, ...stats });
  }
  top.sort((a, b) => b.count - a.count);
  const summary: QueryScopeSummary = {
    scopeId: scope.id,
    label: scope.label,
    durationMs,
    totalQueries,
    uniqueFingerprints: scope.fingerprints.size,
    errorCount,
    topFingerprints: top.slice(0, 5),
    warnings: top
      .filter((entry) => scope.warned.has(entry.fingerprint))
      .map((entry) => ({
        fingerprint: entry.fingerprint,
        count: entry.count,
        totalDurationMs: entry.totalDurationMs,
        sample: entry.sample,
        scopeLabel: scope.label,
      })),
  };

  if (totalQueries > 0) {
    logger.info('db.query_scope_summary', {
      scopeId: scope.id,
      scopeLabel: scope.label,
      durationMs: Math.round(durationMs),
      totalQueries,
      uniqueFingerprints: scope.fingerprints.size,
      errorCount,
      topFingerprints: summary.topFingerprints.map((entry) => ({
        fingerprint: entry.fingerprint,
        count: entry.count,
        totalDurationMs: Math.round(entry.totalDurationMs),
      })),
      nPlusOneCount: summary.warnings.length,
    });
  }

  return summary;
}
