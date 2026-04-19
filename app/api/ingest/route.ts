import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { INGEST_SYSTEM_PROMPT } from '@/lib/prompts';
import type { IngestRequest, IngestResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IngestRequest;
    if (!body?.source) {
      return NextResponse.json({ error: 'source is required' }, { status: 400 });
    }
    if (!body.source.rawContent) {
      return NextResponse.json({ error: 'source.rawContent is required' }, { status: 400 });
    }
    if (!Array.isArray(body.existingConcepts)) {
      return NextResponse.json({ error: 'existingConcepts must be an array' }, { status: 400 });
    }

    // Read LLM config from request headers (preferred) or fall back to body
    const apiKey = req.headers.get('x-user-api-key') || undefined;
    const apiUrl = req.headers.get('x-user-api-url') || undefined;
    const model = req.headers.get('x-user-model') || undefined;
    const llmConfig = (apiKey || apiUrl || model) ? { apiKey, apiUrl, model } : body.llmConfig;

    // Cap raw content length to keep token usage bounded
    const MAX_RAW = 12000;
    const rawContent = body.source.rawContent.slice(0, MAX_RAW);

    if (body.existingConcepts.length > 500) {
      return NextResponse.json({ error: 'Too many existing concepts' }, { status: 400 });
    }

    const existingList = body.existingConcepts
      .map((c) => `- [${c.id}] ${c.title} — ${c.summary}`)
      .join('\n');

    const userPrompt = `# 新资料

**标题**: ${body.source.title}
**类型**: ${body.source.type}
${body.source.author ? `**作者**: ${body.source.author}\n` : ''}${body.source.url ? `**来源**: ${body.source.url}\n` : ''}

**正文**:
${rawContent}

---

# 现有概念库(共 ${body.existingConcepts.length} 个)

${existingList || '(目前为空)'}

---

请按 system prompt 定义的 JSON schema 输出编译结果。只输出 JSON,不要任何其它内容。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: INGEST_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.5,
      maxTokens: 4000,
      llmConfig,
    });

    const parsed = parseJSON<IngestResponse>(raw);

    // Defensive defaults
    parsed.newConcepts = parsed.newConcepts || [];
    parsed.updatedConcepts = parsed.updatedConcepts || [];
    parsed.activitySummary = parsed.activitySummary ||
      `新建 ${parsed.newConcepts.length} 个概念,更新 ${parsed.updatedConcepts.length} 个`;

    // Filter updatedConcepts to only reference existing IDs
    const existingIds = new Set(body.existingConcepts.map((c) => c.id));
    parsed.updatedConcepts = parsed.updatedConcepts.filter((u) => existingIds.has(u.id));

    // Filter relatedConceptIds in new concepts
    for (const c of parsed.newConcepts) {
      c.relatedConceptIds = (c.relatedConceptIds || []).filter((id) => existingIds.has(id));
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ingest] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
