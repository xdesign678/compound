import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { QUERY_SYSTEM_PROMPT } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import { formatQueryContextForPrompt, wikiRepo } from '@/lib/wiki-db';
import type { Concept, QueryRequest, QueryResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 512_000;
const MAX_CONCEPTS = 500;
const MAX_QUESTION_CHARS = 2_000;
const MAX_HISTORY_MESSAGES = 6;

function conceptFromRequest(c: QueryRequest['concepts'][number]): Concept {
  const now = Date.now();
  return {
    id: c.id,
    title: c.title,
    summary: c.summary,
    body: c.body || '',
    sources: [],
    related: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
    contentStatus: c.body ? 'full' : 'partial',
    categories: [],
    categoryKeys: [],
  };
}

function mergeConcepts(primary: Concept[], secondary: Concept[]): Concept[] {
  const concepts = new Map<string, Concept>();
  for (const concept of [...primary, ...secondary]) {
    const prev = concepts.get(concept.id);
    if (!prev || (!prev.body && concept.body)) {
      concepts.set(concept.id, concept);
    }
  }
  return Array.from(concepts.values());
}

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
    if (body.concepts && !Array.isArray(body.concepts)) {
      return NextResponse.json({ error: 'concepts must be an array' }, { status: 400 });
    }
    if ((body.concepts || []).length > MAX_CONCEPTS) {
      return NextResponse.json({ error: 'Too many concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);

    const serverContext = wikiRepo.searchWikiContext(question, {
      conceptLimit: Number(process.env.COMPOUND_QUERY_CONTEXT_CONCEPT_LIMIT || 24),
      chunkLimit: Number(process.env.COMPOUND_QUERY_CONTEXT_CHUNK_LIMIT || 12),
    });
    const requestConcepts = (body.concepts || []).map(conceptFromRequest);
    const concepts = mergeConcepts(requestConcepts, serverContext.concepts).slice(0, MAX_CONCEPTS);
    const wikiDump =
      formatQueryContextForPrompt({
        ...serverContext,
        concepts,
      }) || '(Wiki 为空)';

    const history = body.conversationHistory
      ? body.conversationHistory
          .slice(-MAX_HISTORY_MESSAGES)
          .map((m) => `${m.role === 'user' ? '用户' : 'Wiki'}: ${m.text.slice(0, 2000)}`)
          .join('\n')
      : '';

    const userPrompt = `# 用户的 Wiki 检索上下文\n\n${wikiDump}\n\n---\n\n${
      history ? `# 最近对话\n\n${history}\n\n---\n\n` : ''
    }# 当前问题\n\n${question}\n\n请优先基于「相关概念页」回答；当概念页不足时，再参考「证据链」和「原文片段候选」。按 system prompt 定义的 JSON schema 输出，只输出 JSON。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: QUERY_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.35,
      maxTokens: 2200,
      llmConfig,
    });

    const parsed = parseJSON<QueryResponse>(raw);
    parsed.citedConceptIds = parsed.citedConceptIds || [];
    parsed.answer = parsed.answer || '(无回答)';
    parsed.archivable = Boolean(parsed.archivable);

    // Ensure citations reference real concept ids
    const validIds = new Set(concepts.map((c) => c.id));
    parsed.citedConceptIds = parsed.citedConceptIds.filter((id) => validIds.has(id));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[query] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Query processing failed. Please check your API configuration.' }, { status: 500 });
  }
}
