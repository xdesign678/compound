import { wikiRepo, type ConceptEvidence } from './wiki-db';
import type { Concept, Source } from './types';

function termsFromConcept(concept: Concept): string[] {
  return Array.from(
    new Set(
      `${concept.title}\n${concept.summary}`
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  ).slice(0, 12);
}

function scoreChunk(content: string, terms: string[]): number {
  const haystack = content.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function quoteFromChunk(content: string): string {
  const cleaned = content
    .replace(/^路径：.+?\n\n/s, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 360);
}

function evidenceForConcept(
  source: Source,
  concept: Concept,
  chunks: ReturnType<typeof wikiRepo.indexSource>,
): Array<Omit<ConceptEvidence, 'id' | 'createdAt'>> {
  const terms = termsFromConcept(concept);
  const ranked = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(chunk.content, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((item) => item.score > 0 || chunks.length <= 3);

  return ranked.map(({ chunk, score }) => ({
    conceptId: concept.id,
    sourceId: source.id,
    chunkId: chunk.id,
    quote: quoteFromChunk(chunk.content),
    claim: concept.summary || `「${concept.title}」由资料「${source.title}」提供支撑。`,
    kind: 'support',
    confidence: score > 0 ? Math.min(0.95, 0.55 + score * 0.08) : 0.42,
  }));
}

export function compileWikiArtifactsAfterIngest(input: {
  source: Source;
  createdConcepts: Concept[];
  updatedConcepts: Array<{ previous: Concept; next: Concept }>;
  activitySummary: string;
}): { chunks: number; evidence: number; conceptsIndexed: number; versions: number } {
  const chunks = wikiRepo.indexSource(input.source);
  const affected = [
    ...input.createdConcepts.map((concept) => ({ previous: undefined, next: concept })),
    ...input.updatedConcepts,
  ];

  let evidenceCount = 0;
  let versionCount = 0;

  for (const item of affected) {
    wikiRepo.indexConcept(item.next);

    if (item.previous) {
      wikiRepo.recordConceptVersion({
        conceptId: item.next.id,
        version: item.next.version,
        previousBody: item.previous.body,
        nextBody: item.next.body,
        sourceIds: [input.source.id],
        changeSummary: input.activitySummary,
      });
      versionCount += 1;
    } else {
      wikiRepo.recordConceptVersion({
        conceptId: item.next.id,
        version: item.next.version,
        nextBody: item.next.body,
        sourceIds: [input.source.id],
        changeSummary: `由资料「${input.source.title}」创建。`,
      });
      versionCount += 1;
    }

    const evidence = evidenceForConcept(input.source, item.next, chunks);
    wikiRepo.addEvidenceBatch(evidence);
    evidenceCount += evidence.length;
  }

  return {
    chunks: chunks.length,
    evidence: evidenceCount,
    conceptsIndexed: affected.length,
    versions: versionCount,
  };
}
