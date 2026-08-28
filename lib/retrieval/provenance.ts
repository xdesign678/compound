/**
 * Pure helpers that connect cited concepts to real source/chunk/evidence ids.
 * Never invents identifiers: every emitted id must already exist on the
 * provided objects (or a caller-supplied known-id set).
 */

import { isApprovedKnowledgeStatus, type Concept, type QueryCitationQuote } from '../types';

export const MAX_PROVENANCE_QUOTE_CHARS = 240;
export const MAX_PROVENANCE_QUOTES = 8;

export interface ProvenanceChunkRef {
  id: string;
  sourceId: string;
  content?: string;
}

export interface ProvenanceEvidenceRef {
  id: string;
  conceptId: string;
  sourceId: string;
  chunkId?: string;
  quote?: string;
}

export interface CitedProvenanceLinks {
  citedConceptIds: string[];
  citedSourceIds: string[];
  citedChunkIds: string[];
  citedEvidenceIds: string[];
  quotes: QueryCitationQuote[];
}

function uniqueIds(ids: Iterable<string>): string[] {
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

function shortenQuote(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROVENANCE_QUOTE_CHARS);
}

export function canEmitCompleteQueryDone(signal?: AbortSignal): boolean {
  return !signal?.aborted;
}

export function filterRetrievalEligibleConcepts<T extends Pick<Concept, 'knowledgeStatus' | 'id'>>(
  concepts: T[],
): T[] {
  return concepts.filter((concept) => isApprovedKnowledgeStatus(concept.knowledgeStatus));
}

/**
 * Build cited source/chunk/evidence ids from objects that already exist.
 * Missing layers are filled only via real evidence↔chunk↔source links.
 */
export function collectCitedProvenance(input: {
  citedConceptIds: string[];
  concepts: Array<{ id: string; sources: string[] }>;
  chunks?: ProvenanceChunkRef[];
  evidence?: ProvenanceEvidenceRef[];
  knownSourceIds?: Iterable<string>;
  knownChunkIds?: Iterable<string>;
  knownEvidenceIds?: Iterable<string>;
}): CitedProvenanceLinks {
  const conceptById = new Map(input.concepts.map((concept) => [concept.id, concept]));
  const citedConceptIds = uniqueIds(input.citedConceptIds).filter((id) => conceptById.has(id));
  const citedSet = new Set(citedConceptIds);

  const chunks = input.chunks ?? [];
  const evidence = input.evidence ?? [];
  const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

  const knownSourceIds = input.knownSourceIds
    ? new Set(uniqueIds(input.knownSourceIds))
    : new Set(
        uniqueIds([
          ...input.concepts.flatMap((concept) => concept.sources),
          ...chunks.map((chunk) => chunk.sourceId),
          ...evidence.map((item) => item.sourceId),
        ]),
      );
  const knownChunkIds = input.knownChunkIds
    ? new Set(uniqueIds(input.knownChunkIds))
    : new Set(chunks.map((chunk) => chunk.id));
  const knownEvidenceIds = input.knownEvidenceIds
    ? new Set(uniqueIds(input.knownEvidenceIds))
    : new Set(evidence.map((item) => item.id));

  const citedEvidence = evidence.filter(
    (item) =>
      citedSet.has(item.conceptId) &&
      knownEvidenceIds.has(item.id) &&
      knownSourceIds.has(item.sourceId),
  );
  const citedEvidenceIds = uniqueIds(citedEvidence.map((item) => item.id));

  const sourceIds = new Set<string>();
  for (const conceptId of citedConceptIds) {
    const concept = conceptById.get(conceptId);
    if (!concept) continue;
    for (const sourceId of concept.sources) {
      if (knownSourceIds.has(sourceId)) sourceIds.add(sourceId);
    }
  }
  for (const item of citedEvidence) sourceIds.add(item.sourceId);

  const chunkIds = new Set<string>();
  for (const item of citedEvidence) {
    if (!item.chunkId) continue;
    if (knownChunkIds.has(item.chunkId) || chunkById.has(item.chunkId)) {
      chunkIds.add(item.chunkId);
      const chunk = chunkById.get(item.chunkId);
      if (chunk && knownSourceIds.has(chunk.sourceId)) sourceIds.add(chunk.sourceId);
    }
  }
  if (chunkIds.size === 0) {
    for (const chunk of chunks) {
      if (!sourceIds.has(chunk.sourceId)) continue;
      if (!knownChunkIds.has(chunk.id)) continue;
      chunkIds.add(chunk.id);
    }
  }

  const quotes: QueryCitationQuote[] = [];
  const seenQuoteKeys = new Set<string>();
  function pushQuote(quote: QueryCitationQuote) {
    if (quotes.length >= MAX_PROVENANCE_QUOTES) return;
    const text = shortenQuote(quote.quote);
    if (!text) return;
    const key = `${quote.sourceId}|${quote.chunkId || ''}|${quote.evidenceId || ''}|${text}`;
    if (seenQuoteKeys.has(key)) return;
    seenQuoteKeys.add(key);
    quotes.push({ ...quote, quote: text });
  }

  for (const item of citedEvidence) {
    pushQuote({
      sourceId: item.sourceId,
      chunkId: item.chunkId && chunkIds.has(item.chunkId) ? item.chunkId : undefined,
      evidenceId: item.id,
      quote: item.quote || chunkById.get(item.chunkId || '')?.content || '',
    });
  }
  if (quotes.length === 0) {
    for (const chunkId of chunkIds) {
      const chunk = chunkById.get(chunkId);
      if (!chunk) continue;
      pushQuote({
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        quote: chunk.content || '',
      });
    }
  }

  return {
    citedConceptIds,
    citedSourceIds: uniqueIds(sourceIds),
    citedChunkIds: uniqueIds(chunkIds),
    citedEvidenceIds,
    quotes,
  };
}
