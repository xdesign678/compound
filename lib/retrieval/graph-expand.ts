/**
 * Concept graph 1-hop expansion.
 *
 * Compound 已经在 `concept_relations` 表里记录了 supports / extends / depends_on /
 * similar_to 等关系，但查询管道一直没用上——这等于把图谱白存了。
 *
 * 这里的策略很轻量：拿到 BM25/向量的 top concepts 后，沿着这些"高质量"关系类型
 * 取它们的 1-hop 邻居（双向），按出现频次排序，再丢回 RRF 第三路。
 *
 * 为什么不上 GraphRAG 的完整社区聚类？因为 Compound 的体量（千级概念）下，
 * 1-hop 已经能拿走绝大部分图谱收益，而不必养一条社区检测流水线。
 */

import type { Concept } from '../types';
import { logger } from '../logging';

const STRONG_RELATION_KINDS = new Set([
  'supports',
  'extends',
  'depends_on',
  'example_of',
  'similar_to',
  'related',
]);

export interface GraphExpandResult {
  /** Expanded concepts (does NOT include seed concepts). */
  concepts: Concept[];
  /** seed concept id → list of neighbor concept ids actually used. */
  trace: Record<string, string[]>;
}

/**
 * Expand seed concepts by one hop along STRONG_RELATION_KINDS edges.
 *
 * @param seedIds  concept ids ranked by upstream retrievers
 * @param max      maximum number of NEIGHBORS to return (cap)
 */
export function graphExpand(seedIds: string[], max = 5): GraphExpandResult {
  if (seedIds.length === 0) return { concepts: [], trace: {} };
  // Lazy-require keeps tests that pass empty seeds (and never touch the DB)
  // independent of the better-sqlite3 native binding.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getServerDb, repo } = require('../server-db') as typeof import('../server-db');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ensureWikiCompilerSchema } = require('../wiki-db') as typeof import('../wiki-db');
  ensureWikiCompilerSchema();

  const db = getServerDb();
  const placeholders = seedIds.map(() => '?').join(',');
  const seedSet = new Set(seedIds);
  const kindsList = Array.from(STRONG_RELATION_KINDS);
  const kindPlaceholders = kindsList.map(() => '?').join(',');

  let rows: Array<{ source_concept_id: string; target_concept_id: string; kind: string }> = [];
  try {
    rows = db
      .prepare(
        `SELECT source_concept_id, target_concept_id, kind
         FROM concept_relations
         WHERE kind IN (${kindPlaceholders})
           AND (source_concept_id IN (${placeholders}) OR target_concept_id IN (${placeholders}))`,
      )
      .all(...kindsList, ...seedIds, ...seedIds) as Array<{
      source_concept_id: string;
      target_concept_id: string;
      kind: string;
    }>;
  } catch (error) {
    logger.warn('graph_expand.query_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { concepts: [], trace: {} };
  }

  // Count neighbor frequency: more incoming edges from seeds → higher rank
  const neighborCount = new Map<string, number>();
  const trace: Record<string, string[]> = {};

  for (const row of rows) {
    const fromSeed = seedSet.has(row.source_concept_id) ? row.source_concept_id : null;
    const fromSeedTarget = seedSet.has(row.target_concept_id) ? row.target_concept_id : null;
    let neighbor: string | null = null;
    let seed: string | null = null;
    if (fromSeed && !seedSet.has(row.target_concept_id)) {
      neighbor = row.target_concept_id;
      seed = fromSeed;
    } else if (fromSeedTarget && !seedSet.has(row.source_concept_id)) {
      neighbor = row.source_concept_id;
      seed = fromSeedTarget;
    }
    if (!neighbor || !seed) continue;
    neighborCount.set(neighbor, (neighborCount.get(neighbor) ?? 0) + 1);
    trace[seed] = trace[seed] || [];
    if (!trace[seed].includes(neighbor)) trace[seed].push(neighbor);
  }

  if (neighborCount.size === 0) return { concepts: [], trace: {} };

  const ranked = Array.from(neighborCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id]) => id);

  const concepts = repo.getConceptsByIds(ranked);
  // Preserve ranked order
  const conceptMap = new Map(concepts.map((c) => [c.id, c]));
  const ordered = ranked.map((id) => conceptMap.get(id)).filter((c): c is Concept => Boolean(c));

  return { concepts: ordered, trace };
}
