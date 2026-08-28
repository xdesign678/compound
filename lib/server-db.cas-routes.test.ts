import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireAdmin } from './server-auth';
import type { Concept, Source } from './types';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-cas-routes-'));
  const previousDataDir = process.env.DATA_DIR;
  const previousCasMode = process.env.COMPOUND_MUTATION_CAS_MODE;
  const previousToken = process.env.COMPOUND_ADMIN_TOKEN;
  process.env.DATA_DIR = tempDir;
  process.env.COMPOUND_ADMIN_TOKEN = 'cas-route-token';
  delete process.env.COMPOUND_MUTATION_CAS_MODE;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      if (previousCasMode === undefined) delete process.env.COMPOUND_MUTATION_CAS_MODE;
      else process.env.COMPOUND_MUTATION_CAS_MODE = previousCasMode;
      if (previousToken === undefined) delete process.env.COMPOUND_ADMIN_TOKEN;
      else process.env.COMPOUND_ADMIN_TOKEN = previousToken;
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
  'revision_conflict HTTP body is stable and 401/404 do not leak the current entity',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const {
      repo,
      assertWritableRevision,
      mutationFailureResponse,
      RevisionConflictError,
      EntityNotFoundError,
    } = await import('./server-db');

    repo.insertSource(makeSource({ id: 's-secret', rawContent: 'classified' }));
    repo.upsertConcept(makeConcept({ id: 'c-secret', title: 'Shown concept' }));

    try {
      assertWritableRevision('source', 's-secret', 99, 1);
      assert.fail('expected conflict');
    } catch (error) {
      assert.ok(error instanceof RevisionConflictError);
      const failure = mutationFailureResponse(error)!;
      assert.equal(failure.status, 409);
      assert.deepEqual(failure.body, {
        code: 'revision_conflict',
        expectedRevision: 99,
        currentRevision: 1,
      });
    }

    const missing = mutationFailureResponse(new EntityNotFoundError('concept', 'c-secret'))!;
    assert.equal(missing.status, 404);
    const missingRaw = JSON.stringify(missing.body);
    assert.equal(missing.body.error, 'concept not found');
    assert.doesNotMatch(missingRaw, /Shown concept/);
    assert.doesNotMatch(missingRaw, /currentRevision/);

    const denied = requireAdmin(
      new Request('http://localhost/api/data/sources', {
        headers: { 'content-type': 'application/json' },
      }),
    );
    assert.ok(denied);
    assert.equal(denied!.status, 401);
    const deniedBody = JSON.stringify(await denied!.json());
    assert.doesNotMatch(deniedBody, /classified/);
    assert.doesNotMatch(deniedBody, /s-secret/);
    assert.doesNotMatch(deniedBody, /currentRevision/);
    assert.equal(repo.getSource('s-secret')?.rawContent, 'classified');
  },
);

test(
  'client concept delete path: conflict is a no-op; success cleans related; repeat is idempotent',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo, getServerDb, RevisionConflictError } = await import('./server-db');

    repo.upsertConcept(makeConcept({ id: 'c-del', title: 'Keep' }));
    repo.upsertConcept(makeConcept({ id: 'c-peer', related: ['c-del'] }));
    const cursorBefore = repo.getLatestSyncCursor();

    let conflict: InstanceType<typeof RevisionConflictError> | undefined;
    try {
      repo.deleteConcept('c-del', { expectedRevision: 9, cas: true });
    } catch (error) {
      if (error instanceof RevisionConflictError) conflict = error;
      else throw error;
    }
    assert.ok(conflict);
    assert.equal(conflict!.expectedRevision, 9);
    assert.equal(conflict!.currentRevision, 1);
    assert.ok(repo.getConcept('c-del'));
    assert.deepEqual(repo.getConcept('c-peer')?.related, ['c-del']);
    assert.equal(repo.getLatestSyncCursor(), cursorBefore);

    const deleted = repo.deleteConcept('c-del', { expectedRevision: 1, cas: true });
    assert.equal(deleted.outcome, 'deleted');
    assert.equal(repo.getConcept('c-del'), null);
    assert.deepEqual(repo.getConcept('c-peer')?.related, []);

    const tombstones = Number(
      (
        getServerDb()
          .prepare(
            `SELECT COUNT(*) AS n FROM sync_changes
              WHERE entity_type = 'concept' AND entity_id = 'c-del' AND operation = 'delete'`,
          )
          .get() as { n: number }
      ).n,
    );
    const again = repo.deleteConcept('c-del', { expectedRevision: 1, cas: true });
    assert.equal(again.outcome, 'already_deleted');
    assert.equal(again.tombstoneWritten, false);
    const tombstonesAfter = Number(
      (
        getServerDb()
          .prepare(
            `SELECT COUNT(*) AS n FROM sync_changes
              WHERE entity_type = 'concept' AND entity_id = 'c-del' AND operation = 'delete'`,
          )
          .get() as { n: number }
      ).n,
    );
    assert.equal(tombstonesAfter, tombstones);
  },
);

test(
  'client writes missing expectedRevision follow log-only vs enforce',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo, RevisionRequiredError, mutationFailureResponse } = await import('./server-db');

    repo.upsertConcept(makeConcept({ id: 'c-log', title: 'Log' }));
    repo.upsertConcept(makeConcept({ id: 'c-enf', title: 'Enforce' }));
    repo.insertSource(makeSource({ id: 's-enf', rawContent: 'keep' }));

    const logged = repo.deleteConcept('c-log', { cas: true });
    assert.equal(logged.outcome, 'deleted');
    assert.equal(repo.getConcept('c-log'), null);

    process.env.COMPOUND_MUTATION_CAS_MODE = 'enforce';
    let required: InstanceType<typeof RevisionRequiredError> | undefined;
    try {
      repo.deleteConcept('c-enf', { cas: true });
    } catch (error) {
      if (error instanceof RevisionRequiredError) required = error;
      else throw error;
    }
    assert.ok(required);
    const failure = mutationFailureResponse(required)!;
    assert.equal(failure.status, 400);
    assert.equal(failure.body.code, 'revision_required');
    assert.ok(repo.getConcept('c-enf'));
    assert.equal(repo.getSource('s-enf')?.rawContent, 'keep');
  },
);

test(
  'concept flag dedupes review items, writes activity+sync, and is visible on the server queue',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    const { repo } = await import('./server-db');
    const { flagConceptIncorrect, listReviewItems } = await import('./review-queue');

    repo.upsertConcept(makeConcept({ id: 'c-flag', title: '可疑概念' }));
    const cursorBefore = repo.getLatestSyncCursor();

    const first = flagConceptIncorrect({
      conceptId: 'c-flag',
      expectedRevision: 1,
      cas: true,
    });
    assert.equal(first.created, true);
    const current = repo.getConcept('c-flag')!;
    repo.upsertConcept({ ...current, body: 'newer body', updatedAt: Date.now() });
    assert.equal(repo.getConcept('c-flag')?.serverRevision, 2);
    const second = flagConceptIncorrect({
      conceptId: 'c-flag',
      expectedRevision: 1,
      cas: true,
    });
    assert.equal(second.created, false);
    assert.equal(second.review.id, first.review.id);
    assert.equal(second.activity?.id, first.activity?.id);

    const open = listReviewItems({ status: 'open' }).filter(
      (item) => item.target_id === 'c-flag' && item.kind === 'concept_incorrect',
    );
    assert.equal(open.length, 1);

    const changes = repo.listSyncChanges({
      after: cursorBefore,
      before: repo.getLatestSyncCursor(),
      limit: 50,
    });
    assert.ok(
      changes.some(
        (change) =>
          change.entityType === 'activity' &&
          change.entityId === first.activity?.id &&
          change.operation === 'upsert',
      ),
      'second device can observe the flag activity via delta',
    );
    assert.equal(repo.getActivityByIds([first.activity!.id]).length, 1);
  },
);
