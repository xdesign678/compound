import type { RerankCandidate } from './llm-rerank';

export type RetrievalMode = 'remote-emb' | 'local-hash' | 'fts-only';
export type RerankDecisionReason =
  | 'empty'
  | 'already-within-final-top-k'
  | 'fts-fast-path'
  | 'enabled';

export interface RerankDecision {
  useLlm: boolean;
  reason: RerankDecisionReason;
}

function envFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getRerankCandidateLimit(topK: number): number {
  const fallback = Math.max(topK * 2, topK + 4, 12);
  return readPositiveInt(process.env.COMPOUND_RERANK_CANDIDATE_LIMIT, fallback);
}

export function limitRerankCandidates(
  candidates: RerankCandidate[],
  limit: number,
): RerankCandidate[] {
  return candidates.slice(0, Math.max(1, limit));
}

export function decideRerank(input: {
  candidateCount: number;
  finalTopK: number;
  retrievalMode: RetrievalMode;
}): RerankDecision {
  if (input.candidateCount === 0) return { useLlm: false, reason: 'empty' };
  if (input.candidateCount <= input.finalTopK) {
    return { useLlm: false, reason: 'already-within-final-top-k' };
  }
  if (
    input.retrievalMode !== 'remote-emb' &&
    !envFlagEnabled(process.env.COMPOUND_RERANK_FTS_ONLY)
  ) {
    return { useLlm: false, reason: 'fts-fast-path' };
  }
  return { useLlm: true, reason: 'enabled' };
}
