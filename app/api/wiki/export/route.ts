import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { repo } from '@/lib/server-db';
import { wikiRepo } from '@/lib/wiki-db';

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

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    wikiRepo.ensureSchema();
    const concepts = repo.listConcepts({ summariesOnly: false });
    const sources = repo.listSources({ summariesOnly: true });

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
      files.push({
        path: `wiki/concepts/${slug(concept.title)}-${concept.id}.md`,
        content: [
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
          ...(concept.related.length ? concept.related.map((id) => `- ${id}`) : ['- 暂无关联概念']),
        ].join('\n'),
      });
    }

    files.push({
      path: 'wiki/graph.json',
      content: JSON.stringify(
        {
          nodes: concepts.map((concept) => ({
            id: concept.id,
            title: concept.title,
            summary: concept.summary,
          })),
          edges: concepts.flatMap((concept) =>
            concept.related.map((target) => ({ source: concept.id, target, kind: 'related' })),
          ),
        },
        null,
        2,
      ),
    });

    return NextResponse.json({ ok: true, files });
  } catch (error) {
    console.error('[wiki/export] error:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Wiki export failed' }, { status: 500 });
  }
}
