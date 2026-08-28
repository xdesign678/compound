import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { setLoggerSink } from './logging';
import type { Concept, Source } from './types';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-cas-'));
  const previousDataDir = process.env.DATA_DIR;
  const previousCasMode = process.env.COMPOUND_MUTATION_CAS_MODE;
  process.env.DATA_DIR = tempDir;
  delete process.env.COMPOUND_MUTATION_CAS_MODE;
  closeServerDbGlobal();
  return {
    tempDir,
    cleanup() {
      closeServerDbGlobal();
      setLoggerSink(null);
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      if (previousCasMode === undefined) delete process.env.COMPOUND_MUTATION_CAS_MODE;
      else process.env.COMPOUND_MUTATION_CAS_MODE = previousCasMode;
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function makeSource(overrides: Partial<Source> & { id: string }): Source {
  const ts = Date.now();
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    type: overrides.type ?? 'text',
    rawContent: overrides.rawContent ?? 'body',
    ingestedAt: overrides.ingestedAt ?? ts,
    updatedAt: overrides.updatedAt ?? ts,
    author: overrides.author,
    url: overrides.url,
    externalKey: overrides.externalKey,
    lastSyncedCommitSha: overrides.lastSyncedCommitSha,
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

function countConceptTombstones(
  getServerDb: (typeof import('./server-db'))['getServerDb'],
  id: string,
): number {
  return Number(
    (
      getServerDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM sync_changes
            WHERE entity_type = 'concept' AND entity_id = ? AND operation = 'delete'`,
        )
        .get(id) as { n: number }
    ).n,
  );
}

function captureWarnings(): string[] {
  const lines: string[] = [];
  setLoggerSink({
    debug() {},
    info() {},
    warn(message) {
      lines.push(message);
    },
    error() {},
  });
  return lines;
}

test(
  'additive server_revision migration is reentrant and backfills legacy rows at 1',
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
      INSERT INTO sources (id, title, type, author, url, raw_content, ingested_at, updated_at, external_key, last_synced_commit_sha)
      VALUES ('s-legacy', 'Legacy', 'text', NULL, NULL, 'old', 10, 10, NULL, NULL);
      INSERT INTO concepts (id, title, summary, body, sources, related, created_at, updated_at, version)
      VALUES ('c-legacy', 'Legacy concept', '', 'body', '[]', '[]', 10, 10, 4);
    `);
    legacy.close();

    const { repo, getServerDb } = await import('./server-db');
    const source = repo.getSource('s-legacy');
    const concept = repo.getConcept('c-legacy');
    assert.equal(source?.serverRevision, 1);
    assert.equal(concept?.serverRevision, 1);
    assert.equal(concept?.version, 4);

    closeServerDbGlobal();
    const again = await import('./server-db');
    assert.equal(again.repo.getSource('s-legacy')?.serverRevision, 1);
    assert.equal(again.repo.getConcept('c-legacy')?.serverRevision, 1);
    const columns = (
      again.getServerDb().prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>
    ).map((row) => row.name);
    assert.ok(columns.includes('server_revision'));
  },
);

test(
  'successful source/concept writes increment serverRevision and leave concept.version alone',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo } = await import('./server-db');

    repo.insertSource(makeSource({ id: 's-1', rawContent: 'one' }));
    assert.equal(repo.getSource('s-1')?.serverRevision, 1);
    repo.insertSource(makeSource({ id: 's-1', rawContent: 'two' }));
    assert.equal(repo.getSource('s-1')?.serverRevision, 2);
    assert.equal(repo.getSource('s-1')?.rawContent, 'two');
    repo.updateSourceLastSyncedCommitSha('s-1', 'abc123');
    assert.equal(repo.getSource('s-1')?.lastSyncedCommitSha, 'abc123');
    assert.equal(
      repo.getSource('s-1')?.serverRevision,
      2,
      'sync bookkeeping must not create a content-edit conflict',
    );

    repo.upsertConcept(makeConcept({ id: 'c-1', version: 7, body: 'v1' }));
    const created = repo.getConcept('c-1')!;
    assert.equal(created.serverRevision, 1);
    assert.equal(created.version, 7);
    repo.upsertConcept({ ...created, body: 'v2', version: 7, updatedAt: Date.now() });
    const updated = repo.getConcept('c-1')!;
    assert.equal(updated.serverRevision, 2);
    assert.equal(updated.version, 7);
    assert.equal(updated.body, 'v2');
  },
);

test('idempotent ingest replay does not bump serverRevision', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  const { repo } = await import('./server-db');
  const { beginIngestOperation, completeIngestOperation, hashIngestPayload } =
    await import('./ingest-operations');

  repo.insertSource(makeSource({ id: 's-replay', rawContent: 'payload' }));
  repo.insertActivity({
    id: 'a-replay',
    type: 'ingest',
    title: 'replayed ingest',
    details: 'stored result',
    relatedSourceIds: ['s-replay'],
    at: Date.now(),
  });
  assert.equal(repo.getSource('s-replay')?.serverRevision, 1);

  const payloadHash = hashIngestPayload({
    title: '笔记',
    type: 'text',
    rawContent: 'payload',
  });
  const first = beginIngestOperation('op-cas-replay01', payloadHash);
  assert.equal(first.kind, 'new');
  if (first.kind !== 'new') throw new Error('expected new');
  completeIngestOperation(
    'op-cas-replay01',
    {
      sourceId: 's-replay',
      newConceptIds: [],
      updatedConceptIds: [],
      activityId: 'a-replay',
    },
    first.attemptToken,
  );
  const { ingestSourceToServerDbDetailed } = await import('./server-ingest');
  const replay = await ingestSourceToServerDbDetailed({
    operationId: 'op-cas-replay01',
    title: '笔记',
    type: 'text',
    rawContent: 'payload',
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.sourceId, 's-replay');
  assert.equal(replay.result.activityId, 'a-replay');
  assert.equal(repo.getSource('s-replay')?.serverRevision, 1);
});

test(
  'same-revision dual write: only one mutation wins and the loser has zero side effects',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo, getServerDb, assertWritableRevision, RevisionConflictError } =
      await import('./server-db');

    repo.insertSource(makeSource({ id: 's-race', rawContent: 'original' }));
    const startCursor = repo.getLatestSyncCursor();
    const revision = repo.getSource('s-race')!.serverRevision!;

    getServerDb().transaction(() => {
      const existing = repo.getSource('s-race')!;
      assertWritableRevision('source', 's-race', revision, existing.serverRevision!);
      repo.insertSource({
        ...existing,
        rawContent: 'winner',
        updatedAt: Date.now(),
      });
      repo.insertActivity({
        id: 'a-winner',
        type: 'ingest',
        title: 'winner',
        details: 'winner',
        relatedSourceIds: ['s-race'],
        at: Date.now(),
      });
    })();

    let conflict: InstanceType<typeof RevisionConflictError> | undefined;
    const activityBeforeLoser = repo.listActivity(20).length;
    try {
      getServerDb().transaction(() => {
        const existing = repo.getSource('s-race')!;
        assertWritableRevision('source', 's-race', revision, existing.serverRevision!);
        repo.insertSource({
          ...existing,
          rawContent: 'loser',
          updatedAt: Date.now(),
        });
        repo.insertActivity({
          id: 'a-loser',
          type: 'ingest',
          title: 'loser',
          details: 'loser',
          relatedSourceIds: ['s-race'],
          at: Date.now(),
        });
      })();
    } catch (error) {
      if (error instanceof RevisionConflictError) conflict = error;
      else throw error;
    }

    assert.ok(conflict);
    assert.equal(conflict!.code, 'revision_conflict');
    assert.equal(conflict!.expectedRevision, revision);
    assert.equal(conflict!.currentRevision, 2);
    assert.equal(repo.getSource('s-race')?.rawContent, 'winner');
    assert.equal(repo.getSource('s-race')?.serverRevision, 2);
    assert.equal(repo.listActivity(20).length, activityBeforeLoser);
    assert.equal(repo.getActivityByIds(['a-loser']).length, 0, 'loser activity must not persist');
    const changes = repo.listSyncChanges({
      after: startCursor,
      before: repo.getLatestSyncCursor(),
      limit: 50,
    });
    assert.equal(
      changes.some((change) => change.entityId === 'a-loser'),
      false,
    );
  },
);

test(
  'missing expectedRevision is log-only-allow by default and enforce-reject when configured',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo, getServerDb, assertWritableRevision, RevisionRequiredError, getMutationCasMode } =
      await import('./server-db');

    repo.insertSource(makeSource({ id: 's-mode', rawContent: 'keep' }));
    assert.equal(getMutationCasMode(), 'log-only');

    const warnings = captureWarnings();
    getServerDb().transaction(() => {
      const existing = repo.getSource('s-mode')!;
      assertWritableRevision('source', 's-mode', undefined, existing.serverRevision!);
      repo.insertSource({ ...existing, rawContent: 'log-only-write', updatedAt: Date.now() });
    })();
    assert.equal(repo.getSource('s-mode')?.rawContent, 'log-only-write');
    assert.ok(warnings.some((line) => line.includes('mutation.cas_revision_missing')));
    assert.ok(warnings.some((line) => line.includes('log-only-allow')));

    process.env.COMPOUND_MUTATION_CAS_MODE = 'enforce';
    const before = repo.getSource('s-mode')!;
    let required: InstanceType<typeof RevisionRequiredError> | undefined;
    try {
      getServerDb().transaction(() => {
        const existing = repo.getSource('s-mode')!;
        assertWritableRevision('source', 's-mode', undefined, existing.serverRevision!);
        repo.insertSource({ ...existing, rawContent: 'enforce-write', updatedAt: Date.now() });
      })();
    } catch (error) {
      if (error instanceof RevisionRequiredError) required = error;
      else throw error;
    }
    assert.ok(required);
    assert.equal(required!.code, 'revision_required');
    assert.equal(repo.getSource('s-mode')?.rawContent, before.rawContent);
    assert.equal(repo.getSource('s-mode')?.serverRevision, before.serverRevision);
    assert.ok(warnings.some((line) => line.includes('enforce-reject')));

    process.env.COMPOUND_MUTATION_CAS_MODE = 'enfroce';
    assert.equal(getMutationCasMode(), 'enforce', 'invalid configured modes must fail closed');
    assert.throws(() => {
      getServerDb().transaction(() => {
        const existing = repo.getSource('s-mode')!;
        assertWritableRevision('source', 's-mode', undefined, existing.serverRevision!);
      })();
    }, RevisionRequiredError);
    assert.ok(warnings.some((line) => line.includes('mutation.cas_mode_invalid')));
  },
);

test('expectedRevision accepts only positive safe integers', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  const { InvalidExpectedRevisionError, parseExpectedRevision } = await import('./server-db');

  assert.equal(parseExpectedRevision(1), 1);
  assert.equal(parseExpectedRevision(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of [null, '', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    assert.throws(() => parseExpectedRevision(value), InvalidExpectedRevisionError);
  }
});

test(
  'deleteConcept rolls back related cleanup, aux rows, and tombstone when an aux delete throws',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo, getServerDb } = await import('./server-db');
    const { compileConceptArtifactsAfterManualChange } = await import('./wiki-compiler');

    const doomed = makeConcept({ id: 'doomed', title: 'Doomed', body: 'doomed body' });
    repo.upsertConcept(doomed);
    repo.upsertConcept(makeConcept({ id: 'peer', related: ['doomed'] }));
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [doomed],
      changeSummary: 'seed aux rows',
    });
    const tombstonesBefore = countConceptTombstones(getServerDb, 'doomed');
    const peerRevision = repo.getConcept('peer')!.serverRevision;

    const db = getServerDb();
    const realPrepare = db.prepare.bind(db);
    (db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      if (/DELETE FROM concept_evidence/.test(sql)) throw new Error('injected aux delete failure');
      return realPrepare(sql);
    };

    let threw = false;
    try {
      repo.deleteConcept('doomed', { expectedRevision: 1, cas: true });
    } catch {
      threw = true;
    } finally {
      (db as unknown as { prepare: (sql: string) => unknown }).prepare = realPrepare;
    }

    assert.ok(threw);
    assert.ok(repo.getConcept('doomed'));
    assert.deepEqual(repo.getConcept('peer')?.related, ['doomed']);
    assert.equal(repo.getConcept('peer')?.serverRevision, peerRevision);
    assert.equal(countConceptTombstones(getServerDb, 'doomed'), tombstonesBefore);
  },
);

test(
  'deleteConcept clears related ids, writes one tombstone, and does not resurrect via sync listing',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo, getServerDb } = await import('./server-db');
    const { compileConceptArtifactsAfterManualChange } = await import('./wiki-compiler');

    const gone = makeConcept({
      id: 'gone',
      title: 'Gone',
      body: 'gone body',
      categories: [{ primary: '认知心理学', secondary: '注意' }],
      categoryKeys: ['认知心理学/注意'],
    });
    repo.upsertConcept(gone);
    repo.upsertConcept(makeConcept({ id: 'peer', related: ['gone', 'other'] }));
    repo.upsertCategoryWiki({
      id: 'cw-1',
      primaryCategory: '认知心理学',
      secondaryCategory: '注意',
      bodyMd: 'wiki',
      tocJson: '[]',
      conceptIds: ['gone'],
      conceptIdsHash: 'hash',
      generatedAt: Date.now(),
    });
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [gone],
      changeSummary: 'seed aux rows',
    });

    const result = repo.deleteConcept('gone', { expectedRevision: 1, cas: true });
    assert.equal(result.outcome, 'deleted');
    assert.equal(result.tombstoneWritten, true);
    assert.equal(repo.getConcept('gone'), null);
    assert.deepEqual(repo.getConcept('peer')?.related, ['other']);
    assert.equal(countConceptTombstones(getServerDb, 'gone'), 1);
    const wiki = repo.getCategoryWiki('认知心理学', '注意');
    assert.equal(wiki?.stale, 1);

    const cursor = repo.getLatestSyncCursor();
    assert.equal(
      repo.listEntityIdsAtSyncCursor('concept', cursor, { limit: 50, offset: 0 }).includes('gone'),
      false,
    );
    const fts = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
          .get('gone') as { n: number }
      ).n,
    );
    assert.equal(fts, 0);

    const again = repo.deleteConcept('gone', { expectedRevision: 1, cas: true });
    assert.equal(again.outcome, 'already_deleted');
    assert.equal(again.tombstoneWritten, false);
    assert.equal(countConceptTombstones(getServerDb, 'gone'), 1);

    assert.throws(
      () => repo.deleteConcept('never-existed', { cas: true }),
      (error: unknown) =>
        Boolean(
          error && typeof error === 'object' && (error as { code?: string }).code === 'not_found',
        ),
    );
    assert.equal(countConceptTombstones(getServerDb, 'never-existed'), 0);
  },
);

test('full/delta/detail mappers return serverRevision', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);
  const { repo } = await import('./server-db');

  repo.insertSource(makeSource({ id: 's-map', rawContent: 'x' }));
  repo.upsertConcept(makeConcept({ id: 'c-map', sources: ['s-map'] }));
  repo.insertSource(makeSource({ id: 's-map', rawContent: 'y' }));

  const fullSource = repo.getSource('s-map');
  const fullConcept = repo.getConcept('c-map');
  const summarySources = repo.getSourcesByIds(['s-map'], { summariesOnly: true });
  const summaryConcepts = repo.getConceptsByIds(['c-map'], { summariesOnly: true });
  assert.equal(fullSource?.serverRevision, 2);
  assert.equal(fullConcept?.serverRevision, 1);
  assert.equal(summarySources[0]?.serverRevision, 2);
  assert.equal(summaryConcepts[0]?.serverRevision, 1);
});
