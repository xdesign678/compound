import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { LINT_SYSTEM_PROMPT } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import type { LintRequest, LintResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 512_000;
const MAX_CONCEPTS = 500;

export async function POST(req: Request) {
  const denied = requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as LintRequest;
    if (!Array.isArray(body?.concepts)) {
      return NextResponse.json({ error: 'concepts must be an array' }, { status: 400 });
    }
    if (body.concepts.length === 0) {
      return NextResponse.json({ findings: [] });
    }
    if (body.concepts.length > MAX_CONCEPTS) {
      return NextResponse.json({ error: 'Too many concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);

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
    console.error('[lint] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Lint processing failed. Please check your API configuration.' }, { status: 500 });
  }
}
