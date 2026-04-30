/**
 * Pure scoring functions for the Q&A evaluation harness.
 *
 * Kept dependency-free so the runner script can import them after a single
 * `tsc` pass without dragging in better-sqlite3 / nanoid / the gateway etc.
 */

export interface GoldenItem {
  /** Stable id used in reports. */
  id: string;
  /** The user-facing question to send to /api/query. */
  question: string;
  /** Optional preceding turns to exercise history-aware rewrite. */
  history?: Array<{ role: 'user' | 'ai'; text: string }>;
  /**
   * Concept ids you expect to be cited / retrieved. Either this OR
   * `expectedConceptTitles` must be present for hit@k / MRR.
   */
  expectedConceptIds?: string[];
  /**
   * Lowercase title fragments to match against retrieved concept titles when
   * you don't know the stable ids (more brittle but easier to author).
   */
  expectedConceptTitles?: string[];
  /** Words / phrases the answer body should mention. */
  expectedKeywords?: string[];
  /** Free-form tag for grouping (e.g. "definition", "comparison"). */
  category?: string;
  /** Optional expected behavior flag: this question SHOULD be answerable. */
  shouldAnswer?: boolean;
}

export interface QueryRunResult {
  /** Echo of the question for traceability. */
  question: string;
  /** Concept ids cited in the answer (1-indexed [CN] markers map to these). */
  citedConceptIds: string[];
  /**
   * Concept ids actually retrieved (best-effort: server returns cited only,
   * so this often equals citedConceptIds — kept for forward compatibility
   * if we ever surface the full retrieval set).
   */
  retrievedConceptIds?: string[];
  /** The Markdown answer body. */
  answer: string;
  /** Wall-clock latency in ms. */
  latencyMs: number;
  /** Whatever the server returned for retrieval mode. */
  retrievalMode?: string;
  /** Optional rewritten query the server logged. */
  rewrittenQuestion?: string;
  /** Set when the server returned a non-2xx or threw. */
  error?: string;
}

export interface RetrievedConcept {
  id: string;
  title: string;
}

export interface ItemScore {
  id: string;
  question: string;
  category?: string;
  hitAt1: 0 | 1;
  hitAt3: 0 | 1;
  hitAt8: 0 | 1;
  /** Mean Reciprocal Rank — 1/rank of first matching concept; 0 if none. */
  mrr: number;
  /** Fraction of expected keywords appearing in the answer body (0–1). */
  keywordRecall: number;
  /** True when no expected concept ids/titles were configured. */
  hitSkipped: boolean;
  /** True when no expected keywords were configured. */
  keywordSkipped: boolean;
  latencyMs: number;
  retrievalMode?: string;
  error?: string;
}

export interface AggregateScore {
  count: number;
  errored: number;
  hitAt1: number;
  hitAt3: number;
  hitAt8: number;
  mrr: number;
  keywordRecall: number;
  latency: {
    avg: number;
    p95: number;
  };
}

/**
 * Returns true when `concept` matches one of the expected ids OR (case-insensitive)
 * one of the expected title fragments.
 */
function conceptMatches(
  concept: RetrievedConcept,
  expectedIds: string[],
  expectedTitles: string[],
): boolean {
  if (expectedIds.includes(concept.id)) return true;
  const lower = concept.title.toLowerCase();
  return expectedTitles.some((t) => lower.includes(t.toLowerCase()));
}

/**
 * Find the 1-based rank of the first matching concept in the candidate list.
 * Returns 0 when no match.
 */
export function firstMatchRank(
  candidates: RetrievedConcept[],
  expectedIds: string[],
  expectedTitles: string[],
): number {
  for (let i = 0; i < candidates.length; i += 1) {
    if (conceptMatches(candidates[i], expectedIds, expectedTitles)) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Build an ItemScore from a query result. The candidate list is used for
 * hit@k / MRR; if you only have ids (not titles), pass them as
 * `[{id, title: ''}]` and rely on id-based matching.
 */
export function scoreItem(
  item: GoldenItem,
  result: QueryRunResult,
  candidates: RetrievedConcept[],
): ItemScore {
  const expectedIds = item.expectedConceptIds ?? [];
  const expectedTitles = item.expectedConceptTitles ?? [];
  const hasIdExpectations = expectedIds.length > 0 || expectedTitles.length > 0;

  const rank = hasIdExpectations ? firstMatchRank(candidates, expectedIds, expectedTitles) : 0;
  const hitAt = (k: number): 0 | 1 => (rank > 0 && rank <= k ? 1 : 0);

  const expectedKeywords = item.expectedKeywords ?? [];
  const lowerAnswer = result.answer.toLowerCase();
  const matchedKeywords = expectedKeywords.filter((kw) => lowerAnswer.includes(kw.toLowerCase()));

  return {
    id: item.id,
    question: item.question,
    category: item.category,
    hitAt1: hasIdExpectations ? hitAt(1) : 0,
    hitAt3: hasIdExpectations ? hitAt(3) : 0,
    hitAt8: hasIdExpectations ? hitAt(8) : 0,
    mrr: hasIdExpectations && rank > 0 ? 1 / rank : 0,
    keywordRecall:
      expectedKeywords.length === 0 ? 0 : matchedKeywords.length / expectedKeywords.length,
    hitSkipped: !hasIdExpectations,
    keywordSkipped: expectedKeywords.length === 0,
    latencyMs: result.latencyMs,
    retrievalMode: result.retrievalMode,
    error: result.error,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Roll a list of per-item scores into an aggregate dashboard. Skipped metrics
 * (item didn't configure expectations) are excluded from the average so a
 * partially-filled golden set still gives meaningful numbers.
 */
export function aggregate(scores: ItemScore[]): AggregateScore {
  const n = scores.length;
  const errored = scores.filter((s) => s.error).length;
  const hitDenom = scores.filter((s) => !s.hitSkipped && !s.error).length;
  const kwDenom = scores.filter((s) => !s.keywordSkipped && !s.error).length;
  const successful = scores.filter((s) => !s.error);

  const avg = (sel: (s: ItemScore) => number, denom: number) =>
    denom === 0 ? 0 : successful.reduce((sum, s) => sum + sel(s), 0) / denom;

  const latencies = successful.map((s) => s.latencyMs);

  return {
    count: n,
    errored,
    hitAt1: hitDenom === 0 ? 0 : avg((s) => s.hitAt1, hitDenom),
    hitAt3: hitDenom === 0 ? 0 : avg((s) => s.hitAt3, hitDenom),
    hitAt8: hitDenom === 0 ? 0 : avg((s) => s.hitAt8, hitDenom),
    mrr: hitDenom === 0 ? 0 : avg((s) => s.mrr, hitDenom),
    keywordRecall: kwDenom === 0 ? 0 : avg((s) => s.keywordRecall, kwDenom),
    latency: {
      avg: latencies.length === 0 ? 0 : latencies.reduce((sum, x) => sum + x, 0) / latencies.length,
      p95: percentile(latencies, 95),
    },
  };
}

export interface DiffEntry {
  metric: string;
  before: number;
  after: number;
  delta: number;
  /** Direction: "good" = improved, "bad" = regressed, "flat" = within tolerance. */
  direction: 'good' | 'bad' | 'flat';
}

const TOLERANCE = 0.005;

/**
 * Compare two aggregates and produce a list of diffs with direction tags so a
 * CLI / CI can highlight regressions. `latency` lower = better; everything
 * else higher = better.
 */
export function diffAggregates(before: AggregateScore | null, after: AggregateScore): DiffEntry[] {
  if (!before) return [];
  const fields: Array<{
    label: string;
    pick: (a: AggregateScore) => number;
    higherIsBetter: boolean;
    isLatency: boolean;
  }> = [
    { label: 'hit@1', pick: (a) => a.hitAt1, higherIsBetter: true, isLatency: false },
    { label: 'hit@3', pick: (a) => a.hitAt3, higherIsBetter: true, isLatency: false },
    { label: 'hit@8', pick: (a) => a.hitAt8, higherIsBetter: true, isLatency: false },
    { label: 'MRR', pick: (a) => a.mrr, higherIsBetter: true, isLatency: false },
    {
      label: 'keyword recall',
      pick: (a) => a.keywordRecall,
      higherIsBetter: true,
      isLatency: false,
    },
    {
      label: 'avg latency (ms)',
      pick: (a) => a.latency.avg,
      higherIsBetter: false,
      isLatency: true,
    },
    {
      label: 'p95 latency (ms)',
      pick: (a) => a.latency.p95,
      higherIsBetter: false,
      isLatency: true,
    },
  ];

  return fields.map(({ label, pick, higherIsBetter, isLatency }) => {
    const b = Number(pick(before) ?? 0);
    const a = Number(pick(after) ?? 0);
    const delta = a - b;
    let direction: DiffEntry['direction'] = 'flat';
    const significant = Math.abs(delta) > (isLatency ? 50 : TOLERANCE);
    if (significant) {
      if (higherIsBetter) {
        direction = delta > 0 ? 'good' : 'bad';
      } else {
        direction = delta < 0 ? 'good' : 'bad';
      }
    }
    return { metric: label, before: b, after: a, delta, direction };
  });
}
