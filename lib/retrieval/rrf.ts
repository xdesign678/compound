/**
 * Reciprocal Rank Fusion.
 *
 * Industry-standard score-free way to combine results from multiple retrievers
 * (BM25 / dense vectors / graph expansion / etc.) without needing to normalize
 * incompatible score scales. Used by Weaviate, Azure AI Search, OpenSearch,
 * Vespa, LlamaIndex.
 *
 * For each ranked list, every item gets `1 / (k + rank)` (rank 0-indexed).
 * Items present in multiple lists accumulate their per-list contributions,
 * so consensus across retrievers wins.
 */

export interface RrfFusedItem<T> {
  id: string;
  item: T;
  score: number;
  /** Per-source contribution map: { 'fts': 0.0156, 'vector': 0.0143 } */
  contributions: Record<string, number>;
}

export interface RrfSource<T> {
  name: string;
  /** Ranked list (best first). */
  items: T[];
  getId(item: T): string;
  /**
   * Optional extra weight for this source. Multiplied into the RRF
   * contribution. Default 1.
   */
  weight?: number;
}

const DEFAULT_K = 60;

export function reciprocalRankFusion<T>(
  sources: Array<RrfSource<T>>,
  options: { k?: number; topK?: number } = {},
): Array<RrfFusedItem<T>> {
  const k = options.k ?? DEFAULT_K;
  const fused = new Map<string, RrfFusedItem<T>>();

  for (const source of sources) {
    const weight = source.weight ?? 1;
    for (let rank = 0; rank < source.items.length; rank += 1) {
      const item = source.items[rank];
      const id = source.getId(item);
      if (!id) continue;
      const contribution = (1 / (k + rank + 1)) * weight;
      const prev = fused.get(id);
      if (prev) {
        prev.score += contribution;
        prev.contributions[source.name] = (prev.contributions[source.name] ?? 0) + contribution;
      } else {
        fused.set(id, {
          id,
          item,
          score: contribution,
          contributions: { [source.name]: contribution },
        });
      }
    }
  }

  const ranked = Array.from(fused.values()).sort((a, b) => b.score - a.score);
  if (options.topK != null && options.topK > 0) {
    return ranked.slice(0, options.topK);
  }
  return ranked;
}
