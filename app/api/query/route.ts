import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts';
import type { QueryRequest, QueryResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as QueryRequest;
    if (!body?.question?.trim()) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }

    if (body.concepts && body.concepts.length > 500) {
      return NextResponse.json({ error: 'Too many concepts' }, { status: 400 });
    }

    const wikiDump = body.concepts
      .map((c) => {
        const body = (c.body || '').slice(0, 1000);
        return `## [${c.id}] ${c.title}\n_${c.summary}_\n\n${body}`;
      })
      .join('\n\n---\n\n');

    const history = body.conversationHistory
      ? body.conversationHistory
          .slice(-6)
          .map((m) => `${m.role === 'user' ? '用户' : 'Wiki'}: ${m.text}`)
          .join('\n')
      : '';

    const userPrompt = `# 用户的 Wiki 全文

${wikiDump || '(Wiki 为空)'}

---

${history ? `# 最近对话\n\n${history}\n\n---\n\n` : ''}# 当前问题

${body.question}

按 system prompt 定义的 JSON schema 输出,只输出 JSON。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.4,
      maxTokens: 2000,
      llmConfig: body.llmConfig,
    });

    const parsed = parseJSON<QueryResponse>(raw);
    parsed.citedConceptIds = parsed.citedConceptIds || [];
    parsed.answer = parsed.answer || '(无回答)';
    parsed.archivable = Boolean(parsed.archivable);

    // Ensure citations reference real concept ids
    const validIds = new Set(body.concepts.map((c) => c.id));
    parsed.citedConceptIds = parsed.citedConceptIds.filter((id) => validIds.has(id));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[query] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
