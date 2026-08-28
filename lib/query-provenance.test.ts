import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Concept, Source } from './types';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-query-provenance-'));
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

function makeSource(id: string, content: string): Source {
  const ts = Date.now();
  return {
    id,
    title: id,
    type: 'text',
    rawContent: content,
    ingestedAt: ts,
    updatedAt: ts,
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
    categories: overrides.categories ?? [],
    categoryKeys: overrides.categoryKeys ?? [],
    createdAt: overrides.createdAt ?? ts,
    updatedAt: overrides.updatedAt ?? ts,
    version: overrides.version ?? 1,
    knowledgeStatus: overrides.knowledgeStatus,
    originKind: overrides.originKind,
  };
}

test('buildQueryRunProvenance and public done fields stay id/quote-only', async () => {
  const { buildQueryRunProvenance, toPublicQueryDoneFields, canEmitCompleteQueryDone } =
    await import('./query-provenance');
  const run = buildQueryRunProvenance({
    originalQuestion: '什么是 Alpha？',
    rewrittenQuestion: 'Alpha 定义',
    rewriteUsed: 'llm',
    modelId: 'test-model',
    promptVersion: 'query-v3-2026-05',
    citedConceptIds: ['c-1'],
    concepts: [{ id: 'c-1', sources: ['s-1'] }],
    chunks: [
      {
        id: 'ch-1',
        sourceId: 's-1',
        chunkIndex: 0,
        heading: 'Alpha',
        headingPath: ['Alpha'],
        content: 'Alpha theory explains the core idea.',
        tokenCount: 8,
        contentHash: 'h1',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    evidence: [
      {
        id: 'ev-1',
        conceptId: 'c-1',
        sourceId: 's-1',
        chunkId: 'ch-1',
        quote: 'Alpha theory explains the core idea.',
        claim: 'Alpha is the core idea.',
        kind: 'support',
        confidence: 0.8,
        createdAt: 1,
      },
    ],
    knownSourceIds: ['s-1'],
    faithfulness: { score: 0.9, level: 'high' },
  });
  const publicDone = toPublicQueryDoneFields(run);
  const serialized = JSON.stringify(publicDone);
  assert.equal(publicDone.queryRunId, run.queryRunId);
  assert.equal(publicDone.originalQuestion, '什么是 Alpha？');
  assert.equal(publicDone.rewrittenQuestion, 'Alpha 定义');
  assert.equal(publicDone.modelId, 'test-model');
  assert.equal(publicDone.promptVersion, 'query-v3-2026-05');
  assert.deepEqual(publicDone.citedConceptIds, ['c-1']);
  assert.deepEqual(publicDone.citedSourceIds, ['s-1']);
  assert.deepEqual(publicDone.citedChunkIds, ['ch-1']);
  assert.deepEqual(publicDone.citedEvidenceIds, ['ev-1']);
  assert.equal(publicDone.citationQuotes?.[0]?.quote.includes('Alpha theory'), true);
  assert.doesNotMatch(serialized, /apiKey|sk-|system prompt|QUERY_SYSTEM_PROMPT|stack/i);
  assert.equal(canEmitCompleteQueryDone(AbortSignal.abort()), false);
});

test(
  'archiveAnswerAsDraft writes draft provenance and excludes the concept from retrieval',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft, persistQueryRun, buildQueryRunProvenance } =
      await import('./query-provenance');
    const { listReviewItems } = await import('./review-queue');

    const source = makeSource(
      's-alpha',
      '# Alpha\n\nAlpha theory explains the core idea with an example.',
    );
    repo.insertSource(source);
    const concept = makeConcept({
      id: 'c-alpha',
      title: 'Alpha',
      summary: 'Alpha theory explains the core idea.',
      body: 'Alpha theory explains the core idea with an example.',
      sources: ['s-alpha'],
    });
    repo.upsertConcept(concept);
    wikiRepo.rebuildAllIndexes();
    const evidence = wikiRepo.getEvidenceForConcepts(['c-alpha'], 3);
    const chunks = wikiRepo.searchChunks('Alpha theory', 3);
    assert.ok(evidence.length > 0, 'seed evidence must exist');
    assert.ok(chunks.length > 0, 'seed chunks must exist');

    const run = persistQueryRun(
      buildQueryRunProvenance({
        originalQuestion: '什么是 Alpha？',
        rewrittenQuestion: 'Alpha 定义',
        modelId: 'test-model',
        promptVersion: 'query-v3-2026-05',
        citedConceptIds: ['c-alpha'],
        concepts: [concept],
        chunks,
        evidence,
        knownSourceIds: ['s-alpha'],
        faithfulness: { score: 0.8, level: 'high' },
      }),
    );

    const archived = archiveAnswerAsDraft({
      title: 'Alpha 综述',
      summary: '综合 Alpha 的回答',
      body: 'Alpha theory explains the core idea. [C1]',
      citedConceptIds: ['c-alpha'],
      queryRunId: run.queryRunId,
    });

    const draft = repo.getConcept(archived.conceptId);
    assert.equal(draft?.knowledgeStatus, 'draft');
    assert.equal(draft?.originKind, 'derived');
    assert.ok((draft?.sources || []).includes('s-alpha'));
    assert.ok((draft?.sources || []).length > 0, 'draft must carry real source ids');

    const provenance = wikiRepo.getConceptProvenance(archived.conceptId);
    assert.equal(provenance?.queryRunId, run.queryRunId);
    assert.equal(provenance?.modelId, 'test-model');
    assert.deepEqual(provenance?.citedConceptIds, ['c-alpha']);
    assert.ok((provenance?.citedSourceIds || []).includes('s-alpha'));
    assert.ok((provenance?.citedChunkIds || []).length > 0);
    assert.ok((provenance?.citedEvidenceIds || []).length > 0);

    const copiedEvidence = wikiRepo.getEvidenceForConcepts([archived.conceptId], 8);
    assert.ok(copiedEvidence.length > 0, 'draft evidence must exist on first write');

    const ftsCount = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
          .get(archived.conceptId) as { n: number }
      ).n,
    );
    assert.equal(ftsCount, 0, 'draft must not enter FTS');

    const retrieved = wikiRepo.searchWikiContext('Alpha 综述', { conceptLimit: 10, chunkLimit: 5 });
    assert.equal(
      retrieved.concepts.some((item) => item.id === archived.conceptId),
      false,
    );
    const candidates = repo.findConceptCandidates('Alpha 综述', 20);
    assert.equal(
      candidates.some((item) => item.id === archived.conceptId),
      false,
    );

    const open = listReviewItems({ status: 'open' }).filter(
      (item) => item.kind === 'derived_draft' && item.target_id === archived.conceptId,
    );
    assert.equal(open.length, 1);
    assert.equal(archived.reviewId, open[0]?.id);
  },
);

test(
  'archive rolls back concept/provenance/review when a later write throws',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const reviewQueue = await import('./review-queue');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft } = await import('./query-provenance');

    repo.insertSource(
      makeSource('s-1', '# Beta\n\nBeta notes for rollback testing with enough text.'),
    );
    repo.upsertConcept(
      makeConcept({
        id: 'c-beta',
        title: 'Beta',
        summary: 'Beta notes',
        body: 'Beta notes for rollback testing with enough text.',
        sources: ['s-1'],
      }),
    );
    wikiRepo.rebuildAllIndexes();

    const originalCreate = reviewQueue.createReviewItem;
    reviewQueue.createReviewItem = () => {
      throw new Error('injected review failure');
    };
    const beforeConcepts = repo.countConcepts();
    let threw = false;
    try {
      archiveAnswerAsDraft({
        title: 'Beta 综述',
        summary: '综合 Beta',
        body: 'Beta notes for rollback testing.',
        citedConceptIds: ['c-beta'],
      });
    } catch {
      threw = true;
    } finally {
      reviewQueue.createReviewItem = originalCreate;
    }

    assert.ok(threw);
    assert.equal(repo.countConcepts(), beforeConcepts);
    assert.equal(
      Number(
        (
          getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
            n: number;
          }
        ).n,
      ),
      0,
    );
    assert.equal(reviewQueue.listReviewItems({ status: 'all' }).length, 0);
  },
);

test(
  'review approve indexes the draft; reject keeps provenance and stays out of retrieval',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft } = await import('./query-provenance');
    const { listReviewItems, resolveReviewItem } = await import('./review-queue');

    repo.insertSource(
      makeSource('s-gamma', '# Gamma\n\nGamma theory is used to test approve and reject.'),
    );
    repo.upsertConcept(
      makeConcept({
        id: 'c-gamma',
        title: 'Gamma',
        summary: 'Gamma theory',
        body: 'Gamma theory is used to test approve and reject.',
        sources: ['s-gamma'],
      }),
    );
    wikiRepo.rebuildAllIndexes();

    const archived = archiveAnswerAsDraft({
      title: 'Gamma 综述',
      summary: '综合 Gamma',
      body: 'Gamma theory is used to test approve and reject.',
      citedConceptIds: ['c-gamma'],
    });
    const approvedItem = listReviewItems({ status: 'open' }).find(
      (item) => item.target_id === archived.conceptId,
    );
    assert.ok(approvedItem);

    const approved = resolveReviewItem(approvedItem!.id, 'approved');
    assert.equal(approved?.status, 'approved');
    const live = repo.getConcept(archived.conceptId);
    assert.equal(live?.knowledgeStatus, 'approved');
    const ftsCount = Number(
      (
        getServerDb()
          .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
          .get(archived.conceptId) as { n: number }
      ).n,
    );
    assert.equal(ftsCount, 1);
    assert.equal(wikiRepo.getConceptVersions(archived.conceptId).length >= 1, true);
    const retrieved = wikiRepo.searchWikiContext('Gamma 综述', { conceptLimit: 10 });
    assert.equal(
      retrieved.concepts.some((item) => item.id === archived.conceptId),
      true,
    );

    const rejectedArchive = archiveAnswerAsDraft({
      title: 'Gamma 次稿',
      summary: '另一份 Gamma',
      body: 'Another gamma draft that should stay rejected.',
      citedConceptIds: ['c-gamma'],
    });
    const rejectedItem = listReviewItems({ status: 'open' }).find(
      (item) => item.target_id === rejectedArchive.conceptId,
    );
    assert.ok(rejectedItem);
    resolveReviewItem(rejectedItem!.id, 'rejected');
    assert.equal(repo.getConcept(rejectedArchive.conceptId)?.knowledgeStatus, 'rejected');
    assert.ok(wikiRepo.getConceptProvenance(rejectedArchive.conceptId));
    assert.equal(
      Number(
        (
          getServerDb()
            .prepare(`SELECT COUNT(*) AS n FROM concept_fts WHERE concept_id = ?`)
            .get(rejectedArchive.conceptId) as { n: number }
        ).n,
      ),
      0,
    );
    assert.equal(
      wikiRepo
        .searchWikiContext('Gamma 次稿', { conceptLimit: 10 })
        .concepts.some((item) => item.id === rejectedArchive.conceptId),
      false,
    );
  },
);

test(
  'archive with queryRunId extras is 409 and writes nothing',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const {
      archiveAnswerAsDraft,
      persistQueryRun,
      buildQueryRunProvenance,
      ArchiveAnswerError,
      ARCHIVE_CITED_CONCEPTS_MISMATCH,
    } = await import('./query-provenance');
    const { listReviewItems } = await import('./review-queue');

    repo.insertSource(makeSource('s-a', '# Alpha\n\nAlpha theory explains the core idea.'));
    repo.insertSource(makeSource('s-b', '# Beta\n\nBeta notes should not become a citation.'));
    const conceptA = makeConcept({
      id: 'c-a',
      title: 'Alpha',
      summary: 'Alpha theory',
      body: 'Alpha theory explains the core idea.',
      sources: ['s-a'],
    });
    const conceptB = makeConcept({
      id: 'c-b',
      title: 'Beta',
      summary: 'Beta notes',
      body: 'Beta notes should not become a citation.',
      sources: ['s-b'],
    });
    repo.upsertConcept(conceptA);
    repo.upsertConcept(conceptB);
    wikiRepo.rebuildAllIndexes();

    const run = persistQueryRun(
      buildQueryRunProvenance({
        originalQuestion: '什么是 Alpha？',
        modelId: 'test-model',
        promptVersion: 'query-v3-2026-05',
        citedConceptIds: ['c-a'],
        concepts: [conceptA],
        knownSourceIds: ['s-a'],
      }),
    );

    const before = {
      concepts: repo.countConcepts(),
      provenance: Number(
        (
          getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
            n: number;
          }
        ).n,
      ),
      reviews: listReviewItems({ status: 'all' }).length,
      activity: repo.listActivity(500).length,
    };

    let error: unknown;
    try {
      archiveAnswerAsDraft({
        title: 'Alpha 综述',
        summary: '综合 Alpha',
        body: 'Alpha theory explains the core idea.',
        citedConceptIds: ['c-a', 'c-b'],
        queryRunId: run.queryRunId,
      });
    } catch (err) {
      error = err;
    }

    assert.ok(error instanceof ArchiveAnswerError);
    assert.equal(
      (error as InstanceType<typeof ArchiveAnswerError>).code,
      'cited_concepts_mismatch',
    );
    assert.equal((error as InstanceType<typeof ArchiveAnswerError>).status, 409);
    assert.equal((error as Error).message, ARCHIVE_CITED_CONCEPTS_MISMATCH);
    assert.equal(repo.countConcepts(), before.concepts);
    assert.equal(
      Number(
        (
          getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
            n: number;
          }
        ).n,
      ),
      before.provenance,
    );
    assert.equal(listReviewItems({ status: 'all' }).length, before.reviews);
    assert.equal(repo.listActivity(500).length, before.activity);
  },
);

test(
  'unknown queryRunId is 404 and does not fall back to body citations',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft, ArchiveAnswerError, ARCHIVE_QUERY_RUN_NOT_FOUND } =
      await import('./query-provenance');
    const { listReviewItems } = await import('./review-queue');

    repo.insertSource(makeSource('s-a', '# Alpha\n\nAlpha theory explains the core idea.'));
    repo.upsertConcept(
      makeConcept({
        id: 'c-a',
        title: 'Alpha',
        summary: 'Alpha theory',
        body: 'Alpha theory explains the core idea.',
        sources: ['s-a'],
      }),
    );
    wikiRepo.rebuildAllIndexes();

    const before = {
      concepts: repo.countConcepts(),
      provenance: Number(
        (
          getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
            n: number;
          }
        ).n,
      ),
      reviews: listReviewItems({ status: 'all' }).length,
      activity: repo.listActivity(500).length,
    };

    let error: unknown;
    try {
      archiveAnswerAsDraft({
        title: 'Alpha 综述',
        summary: '综合 Alpha',
        body: 'Alpha theory explains the core idea.',
        citedConceptIds: ['c-a'],
        queryRunId: 'qr-does-not-exist',
      });
    } catch (err) {
      error = err;
    }

    assert.ok(error instanceof ArchiveAnswerError);
    assert.equal((error as InstanceType<typeof ArchiveAnswerError>).code, 'query_run_not_found');
    assert.equal((error as InstanceType<typeof ArchiveAnswerError>).status, 404);
    assert.equal((error as Error).message, ARCHIVE_QUERY_RUN_NOT_FOUND);
    assert.equal(repo.countConcepts(), before.concepts);
    assert.equal(
      Number(
        (
          getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
            n: number;
          }
        ).n,
      ),
      before.provenance,
    );
    assert.equal(listReviewItems({ status: 'all' }).length, before.reviews);
    assert.equal(repo.listActivity(500).length, before.activity);
  },
);

test('approve rolls back when index compilation throws', { concurrency: false }, async (t) => {
  const env = setupTempDb();
  t.after(env.cleanup);

  const { repo } = await import('./server-db');
  const { wikiRepo } = await import('./wiki-db');
  const { archiveAnswerAsDraft } = await import('./query-provenance');
  const { listReviewItems, resolveReviewItem, getReviewItem } = await import('./review-queue');

  repo.insertSource(makeSource('s-delta', '# Delta\n\nDelta notes for compile rollback.'));
  repo.upsertConcept(
    makeConcept({
      id: 'c-delta',
      title: 'Delta',
      summary: 'Delta notes',
      body: 'Delta notes for compile rollback.',
      sources: ['s-delta'],
    }),
  );
  wikiRepo.rebuildAllIndexes();
  const archived = archiveAnswerAsDraft({
    title: 'Delta 综述',
    summary: '综合 Delta',
    body: 'Delta notes for compile rollback.',
    citedConceptIds: ['c-delta'],
  });
  const item = listReviewItems({ status: 'open' }).find(
    (row) => row.target_id === archived.conceptId,
  );
  assert.ok(item);

  const originalIndex = wikiRepo.indexConcept.bind(wikiRepo);
  wikiRepo.indexConcept = () => {
    throw new Error('injected index failure');
  };
  let threw = false;
  try {
    resolveReviewItem(item!.id, 'approved');
  } catch {
    threw = true;
  } finally {
    wikiRepo.indexConcept = originalIndex;
  }

  assert.ok(threw);
  assert.equal(repo.getConcept(archived.conceptId)?.knowledgeStatus, 'draft');
  assert.equal(getReviewItem(item!.id)?.status, 'open');
});

test(
  'archive vs cited-concept delete race never commits a draft pointing at a missing concept',
  { concurrency: false },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);

    const { repo, getServerDb } = await import('./server-db');
    const { wikiRepo } = await import('./wiki-db');
    const { archiveAnswerAsDraft, persistQueryRun, buildQueryRunProvenance, ArchiveAnswerError } =
      await import('./query-provenance');
    const { listReviewItems } = await import('./review-queue');
    const { Worker } = await import('node:worker_threads');

    const cited = makeConcept({
      id: 'c-cited-race',
      title: 'Cited race concept',
      summary: 'Cited for archive/delete race',
      body: 'Cited for archive/delete race with enough text.',
      sources: [],
    });
    repo.upsertConcept(cited);
    wikiRepo.ensureSchema();
    const run = persistQueryRun(
      buildQueryRunProvenance({
        originalQuestion: 'race?',
        modelId: 'test-model',
        promptVersion: 'query-v3-2026-05',
        citedConceptIds: [cited.id],
        concepts: [cited],
      }),
    );

    const before = {
      concepts: repo.countConcepts(),
      provenance: Number(
        (
          getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
            n: number;
          }
        ).n,
      ),
      reviews: listReviewItems({ status: 'all' }).length,
    };

    const serverDbPath = [
      path.join(process.cwd(), 'node_modules/.cache/compound-node-tests/lib/server-db.js'),
      path.join(process.cwd(), 'node_modules/.cache/compound-node-tests-focused/lib/server-db.js'),
    ].find((candidate) => existsSync(candidate));
    assert.ok(serverDbPath, 'compiled server-db.js must exist for the two-connection race');

    const worker = new Worker(
      `
        const { parentPort, workerData } = require('node:worker_threads');
        process.env.DATA_DIR = workerData.dataDir;
        delete global.__compound_sqlite__;
        const { repo } = require(workerData.serverDbPath);
        try {
          const result = repo.deleteConcept(workerData.conceptId);
          parentPort.postMessage({ ok: true, outcome: result && result.outcome });
        } catch (err) {
          parentPort.postMessage({ ok: false, error: String(err) });
        }
      `,
      {
        eval: true,
        workerData: {
          dataDir: process.env.DATA_DIR,
          serverDbPath,
          conceptId: cited.id,
        },
      },
    );

    const workerResult = new Promise<{ ok: boolean; outcome?: string; error?: string }>(
      (resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`worker exited ${code}`));
        });
      },
    );

    let archived: { conceptId: string } | null = null;
    let archiveError: unknown;
    try {
      archived = archiveAnswerAsDraft({
        title: 'Race archive',
        summary: 'Race archive summary',
        body: 'Race archive body',
        citedConceptIds: [cited.id],
        queryRunId: run.queryRunId,
      });
    } catch (err) {
      archiveError = err;
    }
    const child = await workerResult;
    await worker.terminate();

    const derived = repo
      .listConcepts()
      .filter((concept) => concept.title === 'Race archive' && concept.originKind === 'derived');

    for (const draft of derived) {
      for (const relatedId of draft.related) {
        assert.ok(
          repo.getConcept(relatedId),
          `draft ${draft.id} related ${relatedId} must still exist`,
        );
      }
      const provenance = wikiRepo.getConceptProvenance(draft.id);
      for (const citedId of provenance?.citedConceptIds ?? []) {
        if (!repo.getConcept(citedId)) {
          assert.equal(
            draft.related.includes(citedId),
            false,
            'stale archive must not keep a deleted cited concept in related',
          );
        }
      }
    }

    if (archived) {
      const draft = repo.getConcept(archived.conceptId);
      assert.ok(draft);
      for (const relatedId of draft!.related) {
        assert.ok(repo.getConcept(relatedId));
      }
    } else {
      assert.ok(archiveError instanceof ArchiveAnswerError);
      assert.equal((archiveError as InstanceType<typeof ArchiveAnswerError>).status, 404);
      assert.equal(derived.length, 0);
      assert.equal(repo.getConcept(cited.id), null);
      assert.equal(
        Number(
          (
            getServerDb().prepare(`SELECT COUNT(*) AS n FROM concept_provenance`).get() as {
              n: number;
            }
          ).n,
        ),
        before.provenance,
      );
      assert.equal(listReviewItems({ status: 'all' }).length, before.reviews);
    }
    assert.ok(archived || child.ok, 'either archive committed or delete applied');
  },
);
