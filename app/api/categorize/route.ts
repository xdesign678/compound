import { NextResponse } from 'next/server';
import { normalizeCategoryKeys, normalizeCategoryState } from '@/lib/category-normalization';
import { chat, parseJSON } from '@/lib/gateway';
import { CATEGORIZE_SYSTEM_PROMPT } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import type { CategorizeRequest, CategorizeResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 256_000;
const MAX_BATCH_SIZE = 20;

export const POST = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as CategorizeRequest;
    if (!Array.isArray(body.concepts) || body.concepts.length === 0) {
      return NextResponse.json({ error: 'concepts array is required' }, { status: 400 });
    }
    if (body.concepts.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Max ${MAX_BATCH_SIZE} concepts per batch` },
        { status: 400 }
      );
    }

    const llmConfig = readLlmConfigOverride(req, body);

    const conceptList = body.concepts
      .map((c) => `- [${c.id}] ${c.title} — ${c.summary}\n  正文片段: ${(c.body ?? '').slice(0, 200)}`)
      .join('\n');

    const existingCategories = normalizeCategoryKeys(body.existingCategories ?? []).slice(0, 120);
    const categoryList =
      existingCategories.length > 0 ? existingCategories.join(', ') : '(暂无已有分类)';

    const userPrompt = `# 待分类概念(共 ${body.concepts.length} 个)

${conceptList}

---

# 已有分类列表(请优先复用)

${categoryList}

---

请按 system prompt 定义的 JSON schema 输出分类结果。只输出 JSON,不要任何其它内容。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: CATEGORIZE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.3,
      maxTokens: 2000,
      llmConfig,
    });

    const parsed = parseJSON<CategorizeResponse>(raw);
    parsed.results = parsed.results || [];
    parsed.results = parsed.results.map((result) => ({
      ...result,
      categories: normalizeCategoryState({ categories: result.categories || [] }).categories,
    }));

    // Only return results for IDs that were actually requested
    const requestedIds = new Set(body.concepts.map((c) => c.id));
    parsed.results = parsed.results.filter((r) => requestedIds.has(r.id));

    return NextResponse.json(parsed);
  } catch (err) {
    logger.error('categorize.failed', { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: 'Categorize failed. Check API config.', requestId: getRequestContext()?.requestId },
      { status: 500 }
    );
  }
});
