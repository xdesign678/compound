/**
 * Query-run provenance and Ask-answer draft archival.
 *
 * Complete query `done` payloads carry stable ids + short quotes only.
 * The hard gate is: once the cancel/abort signal has fired, do not persist a
 * run and do not emit `done`. A persist-then-disconnect transport race may
 * still leave an audit `query_runs` row the client never received; clients
 * without a `done` event must not archive, and an unknown `queryRunId` is 404.
 */

import { nanoid } from 'nanoid';
import { normalizeCategoryState } from './category-normalization';
import { escapeHTML } from './format';
import { logger } from './logging';
import { getServerDb, repo } from './server-db';
import {
  collectCitedProvenance,
  canEmitCompleteQueryDone,
  filterRetrievalEligibleConcepts,
} from './retrieval/provenance';
import type {
  ActivityLog,
  Concept,
  ConceptProvenanceRecord,
  QueryCitationQuote,
  QueryResponse,
} from './types';
import { wikiRepo, type ConceptEvidence, type SourceChunk } from './wiki-db';
import { compileConceptArtifactsAfterManualChange } from './wiki-compiler';

export const DERIVED_DRAFT_REVIEW_KIND = 'derived_draft' as const;

export type ArchiveAnswerErrorCode =
  | 'query_run_not_found'
  | 'cited_concepts_mismatch'
  | 'no_cited_concepts';

export class ArchiveAnswerError extends Error {
  readonly code: ArchiveAnswerErrorCode;
  readonly status: 404 | 409;

  constructor(code: ArchiveAnswerErrorCode, message: string, status: 404 | 409) {
    super(message);
    this.name = 'ArchiveAnswerError';
    this.code = code;
    this.status = status;
  }
}

export const ARCHIVE_QUERY_RUN_NOT_FOUND = 'query run not found';
export const ARCHIVE_CITED_CONCEPTS_MISMATCH = 'citedConceptIds do not match query run';
export const ARCHIVE_NO_CITED_CONCEPTS = 'no cited concepts found';

export interface QueryRunProvenance {
  queryRunId: string;
  originalQuestion: string;
  rewrittenQuestion?: string;
  modelId: string;
  promptVersion: string;
  citedConceptIds: string[];
  citedSourceIds: string[];
  citedChunkIds: string[];
  citedEvidenceIds: string[];
  quotes: QueryCitationQuote[];
  faithfulness?: QueryResponse['faithfulness'];
  createdAt: number;
}

export type PublicQueryDoneProvenance = Pick<
  QueryResponse,
  | 'queryRunId'
  | 'originalQuestion'
  | 'rewrittenQuestion'
  | 'modelId'
  | 'promptVersion'
  | 'citedConceptIds'
  | 'citedSourceIds'
  | 'citedChunkIds'
  | 'citedEvidenceIds'
  | 'citationQuotes'
  | 'faithfulness'
>;

export interface ArchiveAnswerInput {
  title: string;
  summary: string;
  body: string;
  citedConceptIds: string[];
  queryRunId?: string;
}

export interface ArchiveAnswerResult {
  conceptId: string;
  concepts: Concept[];
  activity: ActivityLog;
  reviewId: string;
}

let queryRunSchemaReady = false;
let queryRunSchemaDb: unknown = null;

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseFaithfulness(value: string | null): QueryResponse['faithfulness'] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { score?: unknown; level?: unknown };
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) return undefined;
    if (parsed.level !== 'low' && parsed.level !== 'mid' && parsed.level !== 'high') {
      return undefined;
    }
    return { score, level: parsed.level };
  } catch {
    return undefined;
  }
}

export function ensureQueryRunSchema(): void {
  const db = getServerDb();
  if (queryRunSchemaReady && queryRunSchemaDb === db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_runs (
      id TEXT PRIMARY KEY,
      original_question TEXT NOT NULL,
      rewritten_question TEXT,
      model_id TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      cited_concept_ids TEXT NOT NULL DEFAULT '[]',
      cited_source_ids TEXT NOT NULL DEFAULT '[]',
      cited_chunk_ids TEXT NOT NULL DEFAULT '[]',
      cited_evidence_ids TEXT NOT NULL DEFAULT '[]',
      quotes_json TEXT NOT NULL DEFAULT '[]',
      faithfulness_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_runs_created ON query_runs(created_at DESC);
  `);
  queryRunSchemaReady = true;
  queryRunSchemaDb = db;
}

export { canEmitCompleteQueryDone, filterRetrievalEligibleConcepts };

export function buildQueryRunProvenance(input: {
  queryRunId?: string;
  originalQuestion: string;
  rewrittenQuestion?: string;
  rewriteUsed?: 'llm' | 'pass-through' | 'fallback';
  modelId: string;
  promptVersion: string;
  citedConceptIds: string[];
  concepts: Array<{ id: string; sources: string[] }>;
  chunks?: SourceChunk[];
  evidence?: ConceptEvidence[];
  knownSourceIds?: Iterable<string>;
  faithfulness?: QueryResponse['faithfulness'];
  now?: number;
}): QueryRunProvenance {
  const links = collectCitedProvenance({
    citedConceptIds: input.citedConceptIds,
    concepts: input.concepts,
    chunks: input.chunks,
    evidence: input.evidence,
    knownSourceIds: input.knownSourceIds,
  });
  const rewritten =
    input.rewriteUsed === 'pass-through'
      ? undefined
      : input.rewrittenQuestion && input.rewrittenQuestion !== input.originalQuestion
        ? input.rewrittenQuestion
        : input.rewrittenQuestion;
  return {
    queryRunId: input.queryRunId || `qr-${nanoid(12)}`,
    originalQuestion: input.originalQuestion,
    rewrittenQuestion: rewritten,
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    ...links,
    faithfulness: input.faithfulness,
    createdAt: input.now ?? Date.now(),
  };
}

export function toPublicQueryDoneFields(run: QueryRunProvenance): PublicQueryDoneProvenance {
  return {
    queryRunId: run.queryRunId,
    originalQuestion: run.originalQuestion,
    rewrittenQuestion: run.rewrittenQuestion,
    modelId: run.modelId,
    promptVersion: run.promptVersion,
    citedConceptIds: run.citedConceptIds,
    citedSourceIds: run.citedSourceIds,
    citedChunkIds: run.citedChunkIds,
    citedEvidenceIds: run.citedEvidenceIds,
    citationQuotes: run.quotes,
    faithfulness: run.faithfulness,
  };
}

export function persistQueryRun(run: QueryRunProvenance): QueryRunProvenance {
  ensureQueryRunSchema();
  getServerDb()
    .prepare(
      `INSERT OR REPLACE INTO query_runs (
          id, original_question, rewritten_question, model_id, prompt_version,
          cited_concept_ids, cited_source_ids, cited_chunk_ids, cited_evidence_ids,
          quotes_json, faithfulness_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.queryRunId,
      run.originalQuestion,
      run.rewrittenQuestion ?? null,
      run.modelId,
      run.promptVersion,
      json(run.citedConceptIds),
      json(run.citedSourceIds),
      json(run.citedChunkIds),
      json(run.citedEvidenceIds),
      json(run.quotes),
      run.faithfulness ? json(run.faithfulness) : null,
      run.createdAt,
    );
  return run;
}

export function getQueryRun(queryRunId: string): QueryRunProvenance | null {
  ensureQueryRunSchema();
  if (!queryRunId) return null;
  const row = getServerDb().prepare(`SELECT * FROM query_runs WHERE id = ?`).get(queryRunId) as
    | {
        id: string;
        original_question: string;
        rewritten_question: string | null;
        model_id: string;
        prompt_version: string;
        cited_concept_ids: string;
        cited_source_ids: string;
        cited_chunk_ids: string;
        cited_evidence_ids: string;
        quotes_json: string;
        faithfulness_json: string | null;
        created_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    queryRunId: row.id,
    originalQuestion: row.original_question,
    rewrittenQuestion: row.rewritten_question ?? undefined,
    modelId: row.model_id,
    promptVersion: row.prompt_version,
    citedConceptIds: parseJsonArray<string>(row.cited_concept_ids),
    citedSourceIds: parseJsonArray<string>(row.cited_source_ids),
    citedChunkIds: parseJsonArray<string>(row.cited_chunk_ids),
    citedEvidenceIds: parseJsonArray<string>(row.cited_evidence_ids),
    quotes: parseJsonArray<QueryCitationQuote>(row.quotes_json),
    faithfulness: parseFaithfulness(row.faithfulness_json),
    createdAt: row.created_at,
  };
}

export function finalizeCompleteQueryRun(
  input: Parameters<typeof buildQueryRunProvenance>[0] & { signal?: AbortSignal },
): QueryRunProvenance | null {
  if (!canEmitCompleteQueryDone(input.signal)) return null;
  return persistQueryRun(buildQueryRunProvenance(input));
}

function existingSourceIds(ids: string[]): string[] {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  return unique.filter((id) => Boolean(repo.getSource(id)));
}

function existingConceptIds(ids: string[]): string[] {
  return repo.getConceptsByIds(ids).map((concept) => concept.id);
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function sameIdSet(left: string[], right: string[]): boolean {
  const a = new Set(uniqueIds(left));
  const b = new Set(uniqueIds(right));
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function resolveArchiveLinks(input: ArchiveAnswerInput): {
  citedConcepts: Concept[];
  run: QueryRunProvenance | null;
  sourceIds: string[];
  chunkIds: string[];
  evidenceRows: ConceptEvidence[];
  quotes: QueryCitationQuote[];
  originalQuestion: string;
  rewrittenQuestion?: string;
  modelId: string;
  promptVersion: string;
  faithfulness?: QueryResponse['faithfulness'];
} {
  wikiRepo.ensureSchema();
  const queryRunId = input.queryRunId?.trim() || '';
  let run: QueryRunProvenance | null = null;
  let citedIds: string[] = [];
  if (queryRunId) {
    run = getQueryRun(queryRunId);
    if (!run) {
      throw new ArchiveAnswerError('query_run_not_found', ARCHIVE_QUERY_RUN_NOT_FOUND, 404);
    }
    const bodyIds = uniqueIds(input.citedConceptIds);
    if (bodyIds.length > 0 && !sameIdSet(bodyIds, run.citedConceptIds)) {
      throw new ArchiveAnswerError('cited_concepts_mismatch', ARCHIVE_CITED_CONCEPTS_MISMATCH, 409);
    }
    citedIds = uniqueIds(run.citedConceptIds);
  } else {
    citedIds = uniqueIds(input.citedConceptIds);
  }

  const requestedIds = existingConceptIds(citedIds);
  const citedConcepts = repo.getConceptsByIds(requestedIds);
  const evidenceFromCited = wikiRepo.getEvidenceForConcepts(
    citedConcepts.map((concept) => concept.id),
    4,
  );
  const evidenceFromRun = run ? wikiRepo.getEvidenceByIds(run.citedEvidenceIds) : [];
  const evidenceRows = [
    ...new Map([...evidenceFromCited, ...evidenceFromRun].map((row) => [row.id, row])).values(),
  ];
  const chunks = wikiRepo.getChunksByIds([
    ...(run?.citedChunkIds ?? []),
    ...evidenceRows.map((row) => row.chunkId || '').filter(Boolean),
  ]);
  const knownSourceIds = existingSourceIds([
    ...citedConcepts.flatMap((concept) => concept.sources),
    ...(run?.citedSourceIds ?? []),
    ...evidenceRows.map((row) => row.sourceId),
    ...chunks.map((chunk) => chunk.sourceId),
  ]);
  const links = collectCitedProvenance({
    citedConceptIds: citedConcepts.map((concept) => concept.id),
    concepts: citedConcepts,
    chunks,
    evidence: evidenceRows,
    knownSourceIds,
    knownChunkIds: chunks.map((chunk) => chunk.id),
    knownEvidenceIds: evidenceRows.map((row) => row.id),
  });
  return {
    citedConcepts,
    run,
    sourceIds: links.citedSourceIds,
    chunkIds: links.citedChunkIds,
    evidenceRows: evidenceRows.filter((row) => links.citedEvidenceIds.includes(row.id)),
    quotes: links.quotes.length > 0 ? links.quotes : (run?.quotes ?? []),
    originalQuestion: run?.originalQuestion || input.title,
    rewrittenQuestion: run?.rewrittenQuestion,
    modelId: run?.modelId || 'unknown',
    promptVersion: run?.promptVersion || 'unknown',
    faithfulness: run?.faithfulness,
  };
}

function copyEvidenceToConcept(
  concept: Concept,
  rows: ConceptEvidence[],
  quotes: QueryCitationQuote[],
): void {
  const quoteByEvidence = new Map(
    quotes
      .filter((quote) => quote.evidenceId)
      .map((quote) => [quote.evidenceId as string, quote.quote]),
  );
  const drafts = rows
    .filter((row) => repo.getSource(row.sourceId))
    .map((row) => ({
      conceptId: concept.id,
      sourceId: row.sourceId,
      chunkId: row.chunkId,
      quote: quoteByEvidence.get(row.id) || row.quote,
      claim: row.claim || concept.summary,
      kind: row.kind,
      confidence: row.confidence,
    }));
  if (drafts.length > 0) wikiRepo.addEvidenceBatch(drafts);
}

function seedEvidenceFromSources(
  concept: Concept,
  chunkIds: string[],
  quotes: QueryCitationQuote[],
): void {
  const existing = wikiRepo.getEvidenceForConcepts([concept.id], 8);
  if (existing.length > 0) return;
  const chunks = wikiRepo.getChunksByIds(chunkIds);
  const quoteByChunk = new Map(
    quotes.filter((quote) => quote.chunkId).map((quote) => [quote.chunkId as string, quote.quote]),
  );
  const drafts = chunks
    .filter((chunk) => concept.sources.includes(chunk.sourceId) && repo.getSource(chunk.sourceId))
    .slice(0, 4)
    .map((chunk) => ({
      conceptId: concept.id,
      sourceId: chunk.sourceId,
      chunkId: chunk.id,
      quote: quoteByChunk.get(chunk.id) || chunk.content.replace(/\s+/g, ' ').trim().slice(0, 240),
      claim: concept.summary || `「${concept.title}」由资料支撑。`,
      kind: 'support' as const,
      confidence: 0.55,
    }));
  if (drafts.length > 0) wikiRepo.addEvidenceBatch(drafts);
}

function createDerivedDraftReview(input: {
  title: string;
  conceptId: string;
  queryRunId?: string;
  confidence: number | null;
}): string {
  // Lazy import avoids a load-time cycle with review-queue.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createReviewItem, ensureReviewQueueSchema } =
    require('./review-queue') as typeof import('./review-queue');
  ensureReviewQueueSchema();
  return createReviewItem({
    kind: DERIVED_DRAFT_REVIEW_KIND,
    title: `待审归档：${input.title}`,
    targetType: 'concept',
    targetId: input.conceptId,
    confidence: input.confidence,
    payload: {
      queryRunId: input.queryRunId,
      originKind: 'derived',
      knowledgeStatus: 'draft',
    },
  });
}

function assertCitedRefsStillPresent(requiredIds: string[], presentIds: string[]): void {
  if (presentIds.length === 0) {
    throw new ArchiveAnswerError('no_cited_concepts', ARCHIVE_NO_CITED_CONCEPTS, 404);
  }
  if (!sameIdSet(requiredIds, presentIds)) {
    throw new ArchiveAnswerError('no_cited_concepts', ARCHIVE_NO_CITED_CONCEPTS, 404);
  }
  for (const id of presentIds) {
    if (!repo.getConcept(id)) {
      throw new ArchiveAnswerError('no_cited_concepts', ARCHIVE_NO_CITED_CONCEPTS, 404);
    }
  }
}

export function archiveAnswerAsDraft(input: ArchiveAnswerInput): ArchiveAnswerResult {
  wikiRepo.ensureSchema();
  ensureQueryRunSchema();
  // DDL stays outside the writer lock; review schema is created lazily.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ensureReviewQueueSchema } = require('./review-queue') as typeof import('./review-queue');
  ensureReviewQueueSchema();

  const db = getServerDb();
  return db
    .transaction((): ArchiveAnswerResult => {
      const resolved = resolveArchiveLinks(input);
      const requiredIds = uniqueIds(
        resolved.run ? resolved.run.citedConceptIds : input.citedConceptIds,
      );
      const validCitedIds = resolved.citedConcepts.map((concept) => concept.id);
      if (resolved.run) {
        assertCitedRefsStillPresent(requiredIds, validCitedIds);
      } else if (validCitedIds.length === 0) {
        throw new ArchiveAnswerError('no_cited_concepts', ARCHIVE_NO_CITED_CONCEPTS, 404);
      } else {
        for (const id of validCitedIds) {
          if (!repo.getConcept(id)) {
            throw new ArchiveAnswerError('no_cited_concepts', ARCHIVE_NO_CITED_CONCEPTS, 404);
          }
        }
      }

      const liveSourceIds = existingSourceIds(resolved.sourceIds);
      if (liveSourceIds.length === 0) {
        logger.warn('archive.missing_sources', { citedConceptIds: validCitedIds });
      }

      const now = Date.now();
      const conceptId = `c-${nanoid(8)}`;
      const { categories, categoryKeys } = normalizeCategoryState({ categories: [] });
      const concept: Concept = {
        id: conceptId,
        title: input.title,
        summary: input.summary,
        body: input.body,
        sources: liveSourceIds,
        related: validCitedIds,
        categories,
        categoryKeys,
        createdAt: now,
        updatedAt: now,
        version: 1,
        knowledgeStatus: 'draft',
        originKind: 'derived',
      };

      const activity: ActivityLog = {
        id: `a-${nanoid(8)}`,
        type: 'query',
        title: `归档问答为待审概念 <em>${escapeHTML(input.title)}</em>`,
        details: `基于 ${validCitedIds.length} 个现有概念综合生成，待审核后进入检索`,
        relatedConceptIds: [conceptId, ...validCitedIds],
        relatedSourceIds: liveSourceIds,
        at: now,
      };

      repo.upsertConcept(concept);
      const provenance: ConceptProvenanceRecord = {
        conceptId,
        queryRunId: input.queryRunId || resolved.run?.queryRunId,
        originalQuestion: resolved.originalQuestion,
        rewrittenQuestion: resolved.rewrittenQuestion,
        modelId: resolved.modelId,
        promptVersion: resolved.promptVersion,
        citedConceptIds: validCitedIds,
        citedSourceIds: liveSourceIds,
        citedChunkIds: resolved.chunkIds,
        citedEvidenceIds: resolved.evidenceRows.map((row) => row.id),
        quotes: resolved.quotes,
        faithfulness: resolved.faithfulness,
        createdAt: now,
      };
      wikiRepo.upsertConceptProvenance(provenance);
      copyEvidenceToConcept(concept, resolved.evidenceRows, resolved.quotes);
      seedEvidenceFromSources(concept, resolved.chunkIds, resolved.quotes);
      const reviewId = createDerivedDraftReview({
        title: input.title,
        conceptId,
        queryRunId: provenance.queryRunId,
        confidence: resolved.faithfulness?.score ?? null,
      });
      repo.insertActivity(activity);

      for (const id of validCitedIds) {
        if (!repo.getConcept(id)) {
          throw new ArchiveAnswerError('no_cited_concepts', ARCHIVE_NO_CITED_CONCEPTS, 404);
        }
      }

      return {
        conceptId,
        concepts: repo.getConceptsByIds([conceptId, ...validCitedIds]),
        activity,
        reviewId,
      };
    })
    .immediate();
}

export function approveDerivedDraft(conceptId: string): Concept | null {
  wikiRepo.ensureSchema();
  const concept = repo.getConcept(conceptId);
  if (!concept) return null;

  const now = Date.now();
  const cited = repo.getConceptsByIds(concept.related);
  const relatedUpdates: Concept[] = [];
  for (const related of cited) {
    if (related.related.includes(conceptId)) continue;
    relatedUpdates.push({
      ...related,
      related: [...related.related, conceptId],
      updatedAt: now,
    });
  }

  const approved: Concept = {
    ...concept,
    knowledgeStatus: 'approved',
    originKind: concept.originKind || 'derived',
    updatedAt: now,
  };

  const db = getServerDb();
  db.transaction(() => {
    repo.upsertConcept(approved);
    for (const update of relatedUpdates) repo.upsertConcept(update);
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [approved],
      updatedConcepts: relatedUpdates
        .map((next) => {
          const previous = cited.find((item) => item.id === next.id);
          return previous ? { previous, next } : null;
        })
        .filter((item): item is { previous: Concept; next: Concept } => Boolean(item)),
      sourceIds: approved.sources,
      changeSummary: `审核通过归档概念「${approved.title}」。`,
    });
  })();

  return repo.getConcept(conceptId);
}

export function rejectDerivedDraft(conceptId: string): Concept | null {
  wikiRepo.ensureSchema();
  const concept = repo.getConcept(conceptId);
  if (!concept) return null;
  const rejected: Concept = {
    ...concept,
    knowledgeStatus: 'rejected',
    updatedAt: Date.now(),
  };
  const db = getServerDb();
  db.transaction(() => {
    repo.upsertConcept(rejected);
    wikiRepo.unindexConcept(conceptId);
  })();
  return repo.getConcept(conceptId);
}
