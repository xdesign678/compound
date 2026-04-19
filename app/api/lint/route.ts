import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { LINT_SYSTEM_PROMPT } from '@/lib/prompts';
import type { LintRequest, LintResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LintRequest;
    if (!body?.concepts || body.concepts.length === 0) {
      return NextResponse.json({ findings: [] });
    }

    const listing = body.concepts
      .map((c) =>
        `[${c.id}] ${c.title}\n  summary: ${c.summary}\n  related: ${c.related.join(', ') || '(none)'}`
      )
      .join('\n\n');

    const userPrompt = `# 当前 Wiki 的概念索引

${listing}

---

请按 system prompt 定义的 JSON schema 输出 lint 发现,只输出 JSON。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: LINT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.3,
      maxTokens: 2000,
      llmConfig: body.llmConfig,
    });

    const parsed = parseJSON<LintResponse>(raw);
    parsed.findings = parsed.findings || [];

    const validIds = new Set(body.concepts.map((c) => c.id));
    parsed.findings = parsed.findings.filter((f) => {
      f.conceptIds = (f.conceptIds || []).filter((id) => validIds.has(id));
      return f.conceptIds.length > 0;
    });

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[lint] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
