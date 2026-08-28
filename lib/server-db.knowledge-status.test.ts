import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Concept } from './types';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-knowledge-status-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    tempDir,
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
    knowledgeStatus: overrides.knowledgeStatus,
    originKind: overrides.originKind,
  };
}

test(
  'knowledge_status/origin_kind migration is additive, reentrant, and defaults legacy rows',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const dbPath = path.join(env.tempDir, 'compound.db');
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        author TEXT,
        url TEXT,
        raw_content TEXT NOT NULL,
        ingested_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        external_key TEXT,
        last_synced_commit_sha TEXT
      );
      CREATE TABLE concepts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        body TEXT NOT NULL,
        sources TEXT NOT NULL,
        related TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO concepts (id, title, summary, body, sources, related, created_at, updated_at, version)
      VALUES ('c-legacy', 'Legacy concept', '', 'body', '[]', '[]', 10, 10, 4);
    `);
    legacy.close();

    const { repo } = await import('./server-db');
    const concept = repo.getConcept('c-legacy');
    assert.equal(concept?.knowledgeStatus, 'approved');
    assert.equal(concept?.originKind, 'manual');
    assert.equal(concept?.version, 4);

    closeServerDbGlobal();
    const again = await import('./server-db');
    const columns = (
      again.getServerDb().prepare(`PRAGMA table_info(concepts)`).all() as Array<{ name: string }>
    ).map((row) => row.name);
    assert.equal(columns.includes('knowledge_status'), true);
    assert.equal(columns.includes('origin_kind'), true);
    assert.equal(again.repo.getConcept('c-legacy')?.knowledgeStatus, 'approved');
  },
);

test(
  'upsertConcept preserves draft status unless explicitly overwritten',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo } = await import('./server-db');
    repo.upsertConcept(
      makeConcept({ id: 'c-draft', knowledgeStatus: 'draft', originKind: 'derived' }),
    );
    const stored = repo.getConcept('c-draft');
    assert.equal(stored?.knowledgeStatus, 'draft');
    assert.equal(stored?.originKind, 'derived');

    repo.upsertConcept({
      ...stored!,
      title: 'Updated draft',
      knowledgeStatus: undefined,
      originKind: undefined,
    });
    const updated = repo.getConcept('c-draft');
    assert.equal(updated?.title, 'Updated draft');
    assert.equal(updated?.knowledgeStatus, 'draft');
    assert.equal(updated?.originKind, 'derived');
  },
);

test(
  'findConceptCandidates excludes draft and rejected concepts',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo } = await import('./server-db');
    repo.upsertConcept(
      makeConcept({
        id: 'c-live',
        title: 'Embodied cognition',
        summary: 'live concept about embodied cognition',
      }),
    );
    repo.upsertConcept(
      makeConcept({
        id: 'c-draft',
        title: 'Embodied cognition draft',
        summary: 'draft concept about embodied cognition',
        knowledgeStatus: 'draft',
        originKind: 'derived',
      }),
    );
    repo.upsertConcept(
      makeConcept({
        id: 'c-rejected',
        title: 'Embodied cognition rejected',
        summary: 'rejected concept about embodied cognition',
        knowledgeStatus: 'rejected',
        originKind: 'derived',
      }),
    );

    const candidates = repo.findConceptCandidates('embodied cognition', 20);
    const ids = candidates.map((concept) => concept.id);
    assert.equal(ids.includes('c-live'), true);
    assert.equal(ids.includes('c-draft'), false);
    assert.equal(ids.includes('c-rejected'), false);
  },
);
