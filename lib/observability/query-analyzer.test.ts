import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setLoggerSink } from '../server-logger';
import {
  DEFAULT_N_PLUS_ONE_THRESHOLD,
  fingerprintSql,
  finishQueryScope,
  createQueryScope,
  getQueryAnalyzerSnapshot,
  getQueryScope,
  recordQueryExecution,
  resetQueryAnalyzerForTests,
  runWithExistingQueryScope,
  runWithQueryScope,
} from './query-analyzer';

interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
}

function captureLogs(): { logs: CapturedLog[]; restore: () => void } {
  const logs: CapturedLog[] = [];
  const push = (level: CapturedLog['level']) => (line: string) => {
    try {
      logs.push({ level, payload: JSON.parse(line) as Record<string, unknown> });
    } catch {
      logs.push({ level, payload: { msg: line } });
    }
  };
  setLoggerSink({
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  });
  return { logs, restore: () => setLoggerSink(null) };
}

function closeServerDbGlobal(): void {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

test('fingerprintSql collapses whitespace and replaces literals', () => {
  const fp1 = fingerprintSql(`SELECT * FROM concepts WHERE id = 'abc'`);
  const fp2 = fingerprintSql(`SELECT  *
                              FROM   concepts
                              WHERE  id =     'def'`);
  const fp3 = fingerprintSql(`SELECT * FROM concepts WHERE id = ?`);
  assert.equal(fp1, fp2);
  assert.equal(fp1, fp3);
  assert.equal(fp1, 'select * from concepts where id = ?');
});

test('fingerprintSql treats numeric and named placeholders as identical', () => {
  const fp1 = fingerprintSql('SELECT * FROM sources WHERE ingested_at > 1700000000 LIMIT 10');
  const fp2 = fingerprintSql('SELECT * FROM sources WHERE ingested_at > ? LIMIT ?');
  const fp3 = fingerprintSql('SELECT * FROM sources WHERE ingested_at > @after LIMIT :limit');
  assert.equal(fp1, fp2);
  assert.equal(fp1, fp3);
});

test('fingerprintSql strips line and block comments', () => {
  const fp1 = fingerprintSql(`-- audit trail
    SELECT id /* the primary key */ FROM concepts`);
  const fp2 = fingerprintSql('SELECT id FROM concepts');
  assert.equal(fp1, fp2);
});

test('runWithQueryScope counts query executions per fingerprint', async (t) => {
  resetQueryAnalyzerForTests();
  const { restore } = captureLogs();
  t.after(restore);

  let observedScopeId: string | undefined;
  await runWithQueryScope(
    () => {
      observedScopeId = getQueryScope()?.id;
      for (let i = 0; i < 3; i += 1) {
        recordQueryExecution({
          fingerprint: fingerprintSql('SELECT * FROM x WHERE id = ?'),
          sql: `SELECT * FROM x WHERE id = ${i}`,
          durationMs: 1,
          success: true,
        });
      }
    },
    { label: 'unit-test', scopeId: 'scope-1' },
  );

  assert.equal(observedScopeId, 'scope-1');
  assert.equal(getQueryScope(), undefined, 'scope must close after fn resolves');

  const snapshot = getQueryAnalyzerSnapshot(5);
  assert.equal(snapshot.totalQueries, 3);
  assert.equal(snapshot.totalNPlusOneIncidents, 0);
});

test('emits db.n_plus_one_detected once when fingerprint crosses threshold', async (t) => {
  resetQueryAnalyzerForTests();
  const { logs, restore } = captureLogs();
  t.after(restore);

  const fingerprint = fingerprintSql('SELECT * FROM concepts WHERE id = ?');

  await runWithQueryScope(
    () => {
      // Run exactly threshold + 5 to confirm the warning fires once at the
      // boundary, not on every subsequent execution.
      for (let i = 0; i < DEFAULT_N_PLUS_ONE_THRESHOLD + 5; i += 1) {
        recordQueryExecution({
          fingerprint,
          sql: `SELECT * FROM concepts WHERE id = '${i}'`,
          durationMs: 0.5,
          success: true,
        });
      }
    },
    { label: 'request:GET /api/test' },
  );

  const warnings = logs.filter(
    (entry) => entry.level === 'warn' && entry.payload.msg === 'db.n_plus_one_detected',
  );
  assert.equal(warnings.length, 1, 'warning should fire exactly once per scope');
  assert.equal(warnings[0]?.payload.fingerprint, fingerprint);
  assert.equal(warnings[0]?.payload.count, DEFAULT_N_PLUS_ONE_THRESHOLD);
  assert.equal(warnings[0]?.payload.scopeLabel, 'request:GET /api/test');

  const snapshot = getQueryAnalyzerSnapshot(5);
  assert.equal(snapshot.totalNPlusOneIncidents, 1);
  assert.equal(snapshot.worstNPlusOneFingerprints[0]?.fingerprint, fingerprint);
});

test('finishQueryScope returns top fingerprints and warnings', async (t) => {
  resetQueryAnalyzerForTests();
  const { restore } = captureLogs();
  t.after(restore);

  const scope = createQueryScope({ label: 'manual-scope' });
  const summary = await runWithExistingQueryScope(scope, async () => {
    for (let i = 0; i < DEFAULT_N_PLUS_ONE_THRESHOLD; i += 1) {
      recordQueryExecution({
        fingerprint: fingerprintSql('SELECT * FROM y WHERE k = ?'),
        sql: `SELECT * FROM y WHERE k = ${i}`,
        durationMs: 2,
        success: true,
      });
    }
    recordQueryExecution({
      fingerprint: fingerprintSql('UPDATE y SET v = ? WHERE k = ?'),
      sql: `UPDATE y SET v = 'a' WHERE k = 1`,
      durationMs: 1,
      success: true,
    });
    return finishQueryScope(scope);
  });

  assert.equal(summary.totalQueries, DEFAULT_N_PLUS_ONE_THRESHOLD + 1);
  assert.equal(summary.uniqueFingerprints, 2);
  assert.equal(summary.warnings.length, 1);
  assert.equal(summary.warnings[0]?.count, DEFAULT_N_PLUS_ONE_THRESHOLD);
  assert.equal(
    summary.topFingerprints[0]?.fingerprint,
    fingerprintSql('SELECT * FROM y WHERE k = ?'),
  );
});

test('instrumentDatabase wraps real better-sqlite3 statements and detects N+1', async (t) => {
  resetQueryAnalyzerForTests();
  const { logs, restore } = captureLogs();
  t.after(restore);

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-query-analyzer-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('../server-db');
  const now = Date.now();
  for (let i = 0; i < DEFAULT_N_PLUS_ONE_THRESHOLD; i += 1) {
    repo.upsertConcept({
      id: `c-${i}`,
      title: `Concept ${i}`,
      summary: 'summary',
      body: 'body',
      sources: [],
      related: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
      categories: [],
      categoryKeys: [],
    });
  }

  await runWithQueryScope(
    () => {
      for (let i = 0; i < DEFAULT_N_PLUS_ONE_THRESHOLD; i += 1) {
        // Per-row fetch: this is precisely the N+1 anti-pattern we want to
        // detect. The wrapper installed by `instrumentDatabase` should
        // observe each prepared `getConcept` call.
        const concept = repo.getConcept(`c-${i}`);
        assert.ok(concept, `expected concept c-${i} to exist`);
      }
    },
    { label: 'realdb-test' },
  );

  const warnings = logs.filter(
    (entry) => entry.level === 'warn' && entry.payload.msg === 'db.n_plus_one_detected',
  );
  assert.equal(warnings.length, 1, 'real-db scope should fire one N+1 warning');
  assert.match(String(warnings[0]?.payload.fingerprint), /select \* from concepts where id = \?/);

  const snapshot = getQueryAnalyzerSnapshot();
  assert.ok(
    snapshot.totalQueries >= DEFAULT_N_PLUS_ONE_THRESHOLD,
    'snapshot must record per-row queries',
  );

  t.after(() => {
    closeServerDbGlobal();
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });
});

test('batched IN (...) lookup avoids the N+1 warning', async (t) => {
  resetQueryAnalyzerForTests();
  const { logs, restore } = captureLogs();
  t.after(restore);

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-query-analyzer-batch-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  const { repo } = await import('../server-db');
  const now = Date.now();
  const ids: string[] = [];
  for (let i = 0; i < DEFAULT_N_PLUS_ONE_THRESHOLD; i += 1) {
    const id = `c-batch-${i}`;
    ids.push(id);
    repo.upsertConcept({
      id,
      title: `Concept ${i}`,
      summary: 'summary',
      body: 'body',
      sources: [],
      related: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
      categories: [],
      categoryKeys: [],
    });
  }

  await runWithQueryScope(
    () => {
      const fetched = repo.getConceptsByIds(ids);
      assert.equal(fetched.length, ids.length);
    },
    { label: 'realdb-batch' },
  );

  const warnings = logs.filter(
    (entry) => entry.level === 'warn' && entry.payload.msg === 'db.n_plus_one_detected',
  );
  assert.equal(warnings.length, 0, 'batched fetch must not trigger an N+1 warning');

  t.after(() => {
    closeServerDbGlobal();
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });
});
