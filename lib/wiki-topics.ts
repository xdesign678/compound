import { getServerDb, repo } from './server-db';
import { parseJson } from './utils';

export interface WikiTopicSummary {
  topic: string;
  sourceCount: number;
  sourceIds: string[];
  sourceTitles: string[];
  entities: string[];
  relatedConcepts: Array<{ id: string; title: string; summary: string }>;
  confidence: number;
  updatedAt: number;
}

interface SourceAnalysisRow {
  source_id: string;
  title: string | null;
  topics: string;
  entities: string;
  confidence: number;
  updated_at: number;
}

function tableExists(name: string): boolean {
  const row = getServerDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function topValues(counter: Map<string, number>, limit: number): string[] {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

export function listWikiTopicSummaries(limit = 50): WikiTopicSummary[] {
  if (!tableExists('source_analysis')) return [];
  const rows = getServerDb()
    .prepare(
      `SELECT source_id, title, topics, entities, confidence, updated_at
       FROM source_analysis
       ORDER BY updated_at DESC
       LIMIT 2000`,
    )
    .all() as SourceAnalysisRow[];

  const groups = new Map<
    string,
    {
      sourceIds: Set<string>;
      sourceTitles: Set<string>;
      entityCounts: Map<string, number>;
      confidenceTotal: number;
      confidenceCount: number;
      updatedAt: number;
    }
  >();

  for (const row of rows) {
    const topics = parseJson<string[]>(row.topics, []).map(normalizeTopic).filter(Boolean);
    const entities = parseJson<string[]>(row.entities, []).map(normalizeTopic).filter(Boolean);
    for (const topic of topics) {
      const group = groups.get(topic) ?? {
        sourceIds: new Set<string>(),
        sourceTitles: new Set<string>(),
        entityCounts: new Map<string, number>(),
        confidenceTotal: 0,
        confidenceCount: 0,
        updatedAt: 0,
      };
      group.sourceIds.add(row.source_id);
      if (row.title) group.sourceTitles.add(row.title);
      for (const entity of entities) {
        group.entityCounts.set(entity, (group.entityCounts.get(entity) ?? 0) + 1);
      }
      group.confidenceTotal += row.confidence;
      group.confidenceCount += 1;
      group.updatedAt = Math.max(group.updatedAt, row.updated_at);
      groups.set(topic, group);
    }
  }

  return Array.from(groups.entries())
    .map(([topic, group]) => ({
      topic,
      sourceCount: group.sourceIds.size,
      sourceIds: Array.from(group.sourceIds),
      sourceTitles: Array.from(group.sourceTitles).slice(0, 12),
      entities: topValues(group.entityCounts, 12),
      relatedConcepts: repo
        .findConceptCandidates(topic, 8)
        .map((concept) => ({ id: concept.id, title: concept.title, summary: concept.summary })),
      confidence: group.confidenceCount > 0 ? group.confidenceTotal / group.confidenceCount : 0.5,
      updatedAt: group.updatedAt,
    }))
    .sort((a, b) => b.sourceCount - a.sourceCount || b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(200, Math.trunc(limit))));
}
