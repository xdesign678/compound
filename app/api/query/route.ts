import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import type { QueryRequest, QueryResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES = 512_000;
const MAX_CONCEPTS = 500;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_MESSAGES = 6;

export async function POST(req: Request) {
  const denied = requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as QueryRequest;
    const question = body?.question?.trim();
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return NextResponse.json({ error: 'question is too long' }, { status: 400 });
    }
    if (!Array.isArray(body.concepts)) {
      return NextResponse.json({ error: 'concepts must be an array' }, { status: 400 });
    }
    if (body.concepts.length > MAX_CONCEPTS) {
      return NextResponse.json({ error: 'Too many concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);

    const wikiDump = body.concepts
      .map((c) => {
        const conceptBody = (c.body || '').slice(0, 1000);
        return `## [${c.id}] ${c.title}\n_${c.summary}_\n\n${conceptBody}`;
      })
      .join('\n\n---\n\n');

    const history = body.conversationHistory
      ? body.conversationHistory
          .slice(-MAX_HISTORY_MESSAGES)
          .map((m) => `${m.role === 'user' ? '用户' : 'Wiki'}: ${m.text.slice(0, 2000)}`)
          .join('\n')
      : '';

    const userPrompt = `# 用户的 Wiki 全文\n\n${wikiDump || '(Wiki 为空)'}\n\n---\n\n${
      history ? `# 最近对话\n\n${history}\n\n---\n\n` : ''
    }# 当前问题\n\n${question}\n\n按 system prompt 定义的 JSON schema 输出,只输出 JSON。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.4,
      maxTokens: 2000,
      llmConfig,
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
    console.error('[query] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Query processing failed. Please check your API configuration.' }, { status: 500 });
  }
}
