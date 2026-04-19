import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { LINT_SYSTEM_PROMPT } from '@/lib/prompts';
import type { LintRequest, LintResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LintRequest;
    if (!Array.isArray(body?.concepts)) {
      return NextResponse.json({ error: 'concepts must be an array' }, { status: 400 });
    }
    if (body.concepts.length === 0) {
      return NextResponse.json({ findings: [] });
    }

    // Read LLM config from request headers (preferred) or fall back to body
    const apiKey = req.headers.get('x-user-api-key') || undefined;
    const apiUrl = req.headers.get('x-user-api-url') || undefined;
    const model = req.headers.get('x-user-model') || undefined;
    const llmConfig = (apiKey || apiUrl || model) ? { apiKey, apiUrl, model } : body.llmConfig;

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
      llmConfig,
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[lint] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
