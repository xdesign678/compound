import { NextResponse } from 'next/server';
import { logger } from '@/lib/logging';
import { requireAdmin } from '@/lib/server-auth';
import { repo } from '@/lib/server-db';
import { wikiRepo } from '@/lib/wiki-db';
import { listWikiTopicSummaries } from '@/lib/wiki-topics';

export const runtime = 'nodejs';
export const maxDuration = 120;

function slug(input: string): string {
  return (
    input
      .trim()
      .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'untitled'
  );
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlArray(values: string[]): string {
  return `[${values.map((value) => yamlString(value)).join(', ')}]`;
}

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    wikiRepo.ensureSchema();
    const concepts = repo.listConcepts({ summariesOnly: false });
    const sources = repo.listSources({ summariesOnly: true });
    const relations = wikiRepo.listConceptRelations();
    const topics = listWikiTopicSummaries(100);

    const files: Array<{ path: string; content: string }> = [];

    files.push({
      path: 'wiki/index.md',
      content: [
        '# Compound Wiki Index',
        '',
        `生成时间：${new Date().toISOString()}`,
        '',
        `概念数：${concepts.length}`,
        `资料数：${sources.length}`,
        '',
        ...concepts.map(
          (concept) =>
            `- [[concepts/${slug(concept.title)}-${concept.id}.md|${concept.title}]] — ${concept.summary}`,
        ),
      ].join('\n'),
    });

    for (const concept of concepts) {
      const evidence = wikiRepo.getEvidenceForConcepts([concept.id], 8);
      const conceptRelations = wikiRepo.getRelationsForConcepts([concept.id], 32);
      files.push({
        path: `wiki/concepts/${slug(concept.title)}-${concept.id}.md`,
        content: [
          '---',
          `id: ${yamlString(concept.id)}`,
          `title: ${yamlString(concept.title)}`,
          `summary: ${yamlString(concept.summary)}`,
          `sources: ${yamlArray(concept.sources)}`,
          `related: ${yamlArray(concept.related)}`,
          `categoryKeys: ${yamlArray(concept.categoryKeys)}`,
          `createdAt: ${concept.createdAt}`,
          `updatedAt: ${concept.updatedAt}`,
          `version: ${concept.version}`,
          '---',
          '',
          `# ${concept.title}`,
          '',
          concept.summary,
          '',
          concept.body,
          '',
          '## Sources',
          ...(concept.sources.length ? concept.sources.map((id) => `- ${id}`) : ['- 暂无来源记录']),
          '',
          '## Evidence',
          ...(evidence.length
            ? evidence.map((item) => `- ${item.claim}${item.quote ? `\n  > ${item.quote}` : ''}`)
            : ['- 暂无证据链记录']),
          '',
          '## Related',
          ...(conceptRelations.length
            ? conceptRelations.map((item) => {
                const direction =
                  item.sourceConceptId === concept.id
                    ? `-> ${item.targetConceptId}`
                    : `<- ${item.sourceConceptId}`;
                return `- ${direction} · ${item.kind} · confidence=${item.confidence.toFixed(2)}${
                  item.reason ? ` · ${item.reason}` : ''
                }`;
              })
            : concept.related.length
              ? concept.related.map((id) => `- ${id}`)
              : ['- 暂无关联概念']),
        ].join('\n'),
      });
    }

    files.push({
      path: 'wiki/topics.md',
      content: [
        '# Topic Summaries',
        '',
        ...topics.flatMap((topic) => [
          `## ${topic.topic}`,
          '',
          `资料数：${topic.sourceCount} · 平均置信度：${topic.confidence.toFixed(2)}`,
          '',
          topic.entities.length ? `实体：${topic.entities.join(', ')}` : '实体：暂无',
          '',
          ...(topic.relatedConcepts.length
            ? topic.relatedConcepts.map((concept) => `- ${concept.title} — ${concept.summary}`)
            : ['- 暂无相关概念候选']),
          '',
        ]),
      ].join('\n'),
    });

    files.push({
      path: 'wiki/topics.json',
      content: JSON.stringify({ topics }, null, 2),
    });

    files.push({
      path: 'wiki/graph.json',
      content: JSON.stringify(
        {
          nodes: concepts.map((concept) => ({
            id: concept.id,
            title: concept.title,
            summary: concept.summary,
            categoryKeys: concept.categoryKeys,
          })),
          edges: relations.map((relation) => ({
            id: relation.id,
            source: relation.sourceConceptId,
            target: relation.targetConceptId,
            kind: relation.kind,
            confidence: relation.confidence,
            reason: relation.reason,
          })),
        },
        null,
        2,
      ),
    });

    return NextResponse.json({ ok: true, files });
  } catch (error) {
    logger.error('wiki.export_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Wiki export failed' }, { status: 500 });
  }
}
