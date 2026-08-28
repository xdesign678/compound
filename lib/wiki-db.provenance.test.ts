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
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-wiki-provenance-'));
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
    summary: overrides.summary ?? 'summary',
    body: overrides.body ?? 'body',
    sources: overrides.sources ?? [],
    related: overrides.related ?? [],
    categories: [],
    categoryKeys: [],
    createdAt: ts,
    updatedAt: ts,
    version: 1,
    knowledgeStatus: overrides.knowledgeStatus,
    originKind: overrides.originKind,
  };
}

test(
  'concept provenance requires a real concept and rebuild skips draft FTS',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');

    repo.insertSource({
      id: 's-1',
      title: 'Alpha Notes',
      type: 'file',
      rawContent: '# Alpha\n\nAlpha theory explains the core idea.',
      ingestedAt: Date.now(),
    });
    repo.upsertConcept(
      makeConcept({
        id: 'c-live',
        title: 'Alpha',
        summary: 'Alpha theory explains the core idea.',
        body: 'Alpha theory explains the core idea.',
        sources: ['s-1'],
      }),
    );
    repo.upsertConcept(
      makeConcept({
        id: 'c-draft',
        title: 'Alpha draft',
        summary: 'Draft alpha page',
        body: 'Draft alpha page should not be indexed.',
        sources: ['s-1'],
        knowledgeStatus: 'draft',
        originKind: 'derived',
      }),
    );

    assert.throws(
      () =>
        wikiRepo.upsertConceptProvenance({
          conceptId: 'c-missing',
          originalQuestion: 'q',
          modelId: 'm',
          promptVersion: 'p',
          citedConceptIds: [],
          citedSourceIds: [],
          citedChunkIds: [],
          citedEvidenceIds: [],
          quotes: [],
          createdAt: Date.now(),
        }),
      /existing concept/,
    );

    wikiRepo.upsertConceptProvenance({
      conceptId: 'c-draft',
      queryRunId: 'qr-1',
      originalQuestion: '什么是 Alpha？',
      modelId: 'test-model',
      promptVersion: 'query-v3-2026-05',
      citedConceptIds: ['c-live'],
      citedSourceIds: ['s-1'],
      citedChunkIds: [],
      citedEvidenceIds: [],
      quotes: [],
      createdAt: Date.now(),
    });
    assert.equal(wikiRepo.getConceptProvenance('c-draft')?.queryRunId, 'qr-1');

    wikiRepo.rebuildAllIndexes();
    const ftsLive = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
          .get('c-live') as { n: number }
      ).n,
    );
    const ftsDraft = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
          .get('c-draft') as { n: number }
      ).n,
    );
    assert.equal(ftsLive, 1);
    assert.equal(ftsDraft, 0);

    const context = wikiRepo.searchWikiContext('Alpha', { conceptLimit: 8, chunkLimit: 4 });
    assert.equal(
      context.concepts.some((concept) => concept.id === 'c-draft'),
      false,
    );
    assert.equal(
      context.concepts.some((concept) => concept.id === 'c-live'),
      true,
    );
  },
);
