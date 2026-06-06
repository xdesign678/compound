import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Concept } from './types';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-concept-atomicity-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeConcept(overrides: Partial<Concept> & { id: string }): Concept {
  const ts = Date.now();
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    summary: overrides.summary ?? '',
    body: overrides.body ?? 'body',
    sources: overrides.sources ?? [],
    related: overrides.related ?? [],
    categories: overrides.categories ?? [],
    categoryKeys: overrides.categoryKeys ?? [],
    createdAt: overrides.createdAt ?? ts,
    updatedAt: overrides.updatedAt ?? ts,
    version: overrides.version ?? 1,
  };
}

test(
  'replaceRelatedId rolls back fully when an update throws mid-loop',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    repo.upsertConcept(makeConcept({ id: 'old' }));
    repo.upsertConcept(makeConcept({ id: 'new' }));
    repo.upsertConcept(makeConcept({ id: 'r1', related: ['old'] }));
    repo.upsertConcept(makeConcept({ id: 'r2', related: ['old'] }));
    repo.upsertConcept(makeConcept({ id: 'r3', related: ['old'] }));

    const original = repo.upsertConcept.bind(repo);
    let calls = 0;
    repo.upsertConcept = (c: Concept) => {
      calls += 1;
      if (calls === 2) throw new Error('injected mid-loop failure');
      return original(c);
    };

    let threw = false;
    try {
      repo.replaceRelatedId('old', 'new', Date.now());
    } catch {
      threw = true;
    } finally {
      repo.upsertConcept = original;
    }

    assert.ok(threw, 'replaceRelatedId should surface the injected error');
    // Atomic: no row should have been rewired — all still reference `old`, none reference `new`.
    for (const id of ['r1', 'r2', 'r3']) {
      const c = repo.getConcept(id)!;
      assert.deepEqual(c.related, ['old'], `${id} must be untouched after rollback`);
    }
  },
);

test(
  'replaceSourceIdInConcepts rolls back fully when an update throws mid-loop',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo } = await import('./server-db');
    repo.upsertConcept(makeConcept({ id: 'c1', sources: ['s-old'] }));
    repo.upsertConcept(makeConcept({ id: 'c2', sources: ['s-old'] }));
    repo.upsertConcept(makeConcept({ id: 'c3', sources: ['s-old'] }));

    const original = repo.upsertConcept.bind(repo);
    let calls = 0;
    repo.upsertConcept = (c: Concept) => {
      calls += 1;
      if (calls === 2) throw new Error('injected mid-loop failure');
      return original(c);
    };

    let threw = false;
    try {
      repo.replaceSourceIdInConcepts('s-old', 's-new', Date.now());
    } catch {
      threw = true;
    } finally {
      repo.upsertConcept = original;
    }

    assert.ok(threw, 'replaceSourceIdInConcepts should surface the injected error');
    for (const id of ['c1', 'c2', 'c3']) {
      const c = repo.getConcept(id)!;
      assert.deepEqual(c.sources, ['s-old'], `${id} must be untouched after rollback`);
    }
  },
);

test(
  'deleteConcept rolls back main + aux deletes when an aux delete throws',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { compileConceptArtifactsAfterManualChange } = await import('./wiki-compiler');

    const concept = makeConcept({ id: 'doomed', title: 'Doomed', body: 'doomed body' });
    repo.upsertConcept(concept);
    // Populate aux tables (concept_fts + concept_versions) for this concept.
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [concept],
      changeSummary: 'seed aux rows',
    });

    const countFts = () =>
      Number(
        (
          getServerDb()
            .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
            .get('doomed') as { n: number }
        ).n,
      );
    const countVersions = () =>
      Number(
        (
          getServerDb()
            .prepare(`SELECT COUNT(*) AS n FROM concept_versions WHERE concept_id = ?`)
            .get('doomed') as { n: number }
        ).n,
      );

    assert.ok(repo.getConcept('doomed'), 'concept exists before delete');
    assert.equal(countFts(), 1, 'fts row exists before delete');
    assert.equal(countVersions(), 1, 'version row exists before delete');

    const db = getServerDb();
    const realPrepare = db.prepare.bind(db);
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (/DELETE FROM concept_evidence/.test(sql)) throw new Error('injected aux delete failure');
      return realPrepare(sql);
    };

    let threw = false;
    try {
      repo.deleteConcept('doomed');
    } catch {
      threw = true;
    } finally {
      (db as unknown as { prepare: (sql: string) => unknown }).prepare = realPrepare;
    }

    assert.ok(threw, 'deleteConcept should surface the injected error');
    // Atomic: nothing should be gone — main row + fts + versions all survive.
    assert.ok(repo.getConcept('doomed'), 'concept survives rollback');
    assert.equal(countFts(), 1, 'fts row survives rollback');
    assert.equal(countVersions(), 1, 'version row survives rollback');
  },
);

test(
  'deleteConcept removes main + aux rows on the happy path',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { compileConceptArtifactsAfterManualChange } = await import('./wiki-compiler');

    const concept = makeConcept({ id: 'gone', title: 'Gone', body: 'gone body' });
    repo.upsertConcept(concept);
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [concept],
      changeSummary: 'seed aux rows',
    });

    repo.deleteConcept('gone');

    assert.equal(repo.getConcept('gone'), null, 'main row removed');
    const fts = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
          .get('gone') as { n: number }
      ).n,
    );
    const versions = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_versions WHERE concept_id = ?`)
          .get('gone') as { n: number }
      ).n,
    );
    assert.equal(fts, 0, 'fts rows removed');
    assert.equal(versions, 0, 'version rows removed');
  },
);
