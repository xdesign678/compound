import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { normalizeCategoryKeys, normalizeCategoryState } from '@/lib/category-normalization';
import { chat, parseJSON } from '@/lib/gateway';
import { CATEGORIZE_SYSTEM_PROMPT, CATEGORIZE_SYSTEM_PROMPT_VERSION } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { repo } from '@/lib/server-db';
import { autoQueueCategoryWikis } from '@/lib/category-wiki-worker';
import { llmRateLimit } from '@/lib/rate-limit';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
  readLlmConfigOverride,
} from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import type { CategorizeRequest, CategorizeResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 256_000;
const MAX_BATCH_SIZE = 20;

function persistCategoryResults(results: CategorizeResponse['results']): string[] {
  const changedConceptIds: string[] = [];
  const ts = Date.now();

  for (const result of results) {
    const concept = repo.getConcept(result.id);
    if (!concept) continue;
    const normalized = normalizeCategoryState({ categories: result.categories || [] });
    if (
      JSON.stringify(concept.categories || []) === JSON.stringify(normalized.categories) &&
      JSON.stringify(concept.categoryKeys || []) === JSON.stringify(normalized.categoryKeys)
    ) {
      continue;
    }
    repo.upsertConcept({
      ...concept,
      categories: normalized.categories,
      categoryKeys: normalized.categoryKeys,
      updatedAt: ts,
      version: concept.version + 1,
    });
    changedConceptIds.push(concept.id);
  }

  return changedConceptIds;
}

export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = await readJsonWithLimit<CategorizeRequest>(req, MAX_BODY_BYTES);
    if (!Array.isArray(body.concepts) || body.concepts.length === 0) {
      return NextResponse.json({ error: 'concepts array is required' }, { status: 400 });
    }
    if (body.concepts.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Max ${MAX_BATCH_SIZE} concepts per batch` },
        { status: 400 },
      );
    }

    const llmConfig = readLlmConfigOverride(req, body);

    const conceptList = body.concepts
      .map(
        (c) => `- [${c.id}] ${c.title} — ${c.summary}\n  正文片段: ${(c.body ?? '').slice(0, 200)}`,
      )
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
      task: 'categorize',
      promptVersion: CATEGORIZE_SYSTEM_PROMPT_VERSION,
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

    const changedConceptIds = persistCategoryResults(parsed.results);
    if (changedConceptIds.length > 0) {
      try {
        autoQueueCategoryWikis({ conceptIds: changedConceptIds });
      } catch (error) {
        logger.warn('categorize.category_wiki_auto_queue_failed', {
          changedConceptIds,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json(parsed);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(apiError(err, getRequestContext()?.requestId, 'categorize.failed'), {
      status: 500,
    });
  }
});
