import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { SELECTION_WIKI_SYSTEM_PROMPT } from '@/lib/prompts';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import { repo, getServerDb } from '@/lib/server-db';
import { normalizeCategoryKeys, normalizeCategoryState } from '@/lib/category-normalization';
import { escapeHTML } from '@/lib/format';
import type {
  ActivityLog,
  CategoryTag,
  Concept,
  SelectionWikiRequest,
  SelectionWikiResponse,
} from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 90;

const MAX_BODY_BYTES = 256_000;
const MAX_SELECTION_CHARS = 4_000;
// 与前端 `ConceptDetail` 保持一致:中文词语常见 2-4 字,阈值太高会让按钮永远不触发。
const MIN_SELECTION_CHARS = 2;
const MAX_CONTEXT_TITLE_CHARS = 200;
const MAX_CANDIDATES = 32;
const MAX_CANDIDATE_BODY_CHARS = 1_200;

interface SelectionLLMConcept {
  title?: string;
  summary?: string;
  body?: string;
  relatedConceptIds?: string[];
  categories?: CategoryTag[];
}

interface SelectionLLMResponse {
  isDuplicate?: boolean;
  duplicateConceptId?: string | null;
  concept?: SelectionLLMConcept;
  activitySummary?: string;
}

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function buildCandidateBlock(candidates: Concept[]): string {
  if (candidates.length === 0) return '(目前为空)';
  return candidates
    .map((concept) => {
      const body = (concept.body || '').trim();
      const truncated =
        body.length > MAX_CANDIDATE_BODY_CHARS
          ? `${body.slice(0, MAX_CANDIDATE_BODY_CHARS)}…`
          : body;
      return `- [${concept.id}] ${concept.title}\n  摘要: ${concept.summary}\n  正文摘录:\n  ${truncated || '(无正文)'}`;
    })
    .join('\n\n');
}

/**
 * Create a brand-new Wiki concept page from a free-form text selection. The
 * selection (typically grabbed from another concept page in the UI) is fed to
 * the LLM together with a candidate list of related Wiki concepts so it can
 * synthesise a focused note that links back into the existing graph.
 *
 * Body: `SelectionWikiRequest` — `selection` is required (>= 2, <= 4k chars).
 * Optional `sourceConceptId` (the page the snippet came from) is added as the
 * first related link; `contextTitle` adds extra grounding. The response mirrors
 * the persisted concept and any concepts that received bidirectional updates,
 * mirroring the shape produced by `/api/ingest`.
 *
 * Guards: admin token, LLM rate limit, 256KB body cap.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as SelectionWikiRequest;
    const selection = clampString(body?.selection, MAX_SELECTION_CHARS);
    if (!selection || selection.length < MIN_SELECTION_CHARS) {
      return NextResponse.json(
        { error: `selection must be at least ${MIN_SELECTION_CHARS} characters` },
        { status: 400 },
      );
    }

    const sourceConceptId = clampString(body?.sourceConceptId, 80) || undefined;
    const contextTitle = clampString(body?.contextTitle, MAX_CONTEXT_TITLE_CHARS) || undefined;

    const llmConfig = readLlmConfigOverride(req, body);

    const searchText = `${contextTitle ?? ''}\n${selection}`;
    const rawCandidates = repo.findConceptCandidates(searchText, MAX_CANDIDATES * 2);
    // Hydrate full bodies for the top candidates so the LLM has enough context
    // to detect duplicates and link existing pages.
    const topCandidates = rawCandidates.slice(0, MAX_CANDIDATES);
    const fullCandidates = repo.getConceptsByIds(
      topCandidates.map((c) => c.id),
      { summariesOnly: false },
    );
    const candidateById = new Map(fullCandidates.map((c) => [c.id, c]));
    const candidates = topCandidates
      .map((c) => candidateById.get(c.id) ?? c)
      .filter((c): c is Concept => Boolean(c));
    const candidateIds = new Set(candidates.map((c) => c.id));

    const existingCategories = normalizeCategoryKeys(repo.listCategoryKeys());
    const categoryList =
      existingCategories.length > 0
        ? `\n# 已有分类列表(请优先复用)\n\n${existingCategories.join(', ')}\n`
        : '';

    const userPrompt = `# 用户选中的文字

${contextTitle ? `**所在概念**: ${contextTitle}\n` : ''}**选中正文**:
${selection}

---

# 现有相关概念(共 ${candidates.length} 条)

${buildCandidateBlock(candidates)}
${categoryList}
---

请基于「选中文字」综合生成一个全新的 Wiki 概念页;若现有相关概念里已有几乎等同的概念,把 isDuplicate 设为 true 并填入 duplicateConceptId。按 system prompt 的 JSON schema 输出,只输出 JSON。`;

    const raw = await chat({
      messages: [
        { role: 'system', content: SELECTION_WIKI_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.5,
      maxTokens: 2400,
      llmConfig,
      task: 'selection-wiki',
    });

    const parsed = parseJSON<SelectionLLMResponse>(raw);
    const draft = parsed.concept ?? {};
    const draftTitle = clampString(draft.title, 60);
    const draftSummary = clampString(draft.summary, 240);
    const draftBody = typeof draft.body === 'string' ? draft.body.trim() : '';
    if (!draftTitle || !draftBody) {
      logger.warn('selection_wiki.empty_draft', {
        hasTitle: Boolean(draftTitle),
        hasBody: Boolean(draftBody),
      });
      return NextResponse.json(
        { error: 'LLM 未能生成有效的概念草稿，请稍后重试。' },
        { status: 502 },
      );
    }

    const duplicateId =
      parsed.isDuplicate && typeof parsed.duplicateConceptId === 'string'
        ? parsed.duplicateConceptId.trim()
        : '';
    if (duplicateId && candidateById.has(duplicateId)) {
      const duplicate = candidateById.get(duplicateId)!;
      const activity: ActivityLog = {
        id: 'a-' + nanoid(8),
        type: 'ingest',
        title: `选段命中已有概念 <em>${escapeHTML(duplicate.title)}</em>`,
        details: parsed.activitySummary || '已有等价概念页，跳过新建',
        relatedConceptIds: [duplicate.id, ...(sourceConceptId ? [sourceConceptId] : [])],
        at: Date.now(),
      };
      const trx = getServerDb().transaction(() => {
        repo.insertActivity(activity);
      });
      trx();
      return NextResponse.json<SelectionWikiResponse>({
        status: 'duplicate',
        conceptId: duplicate.id,
        concepts: [duplicate],
        activity,
      });
    }

    const now = Date.now();
    const newId = 'c-' + nanoid(8);
    const relatedIds = Array.from(
      new Set(
        [
          ...(sourceConceptId ? [sourceConceptId] : []),
          ...(draft.relatedConceptIds || []).filter(
            (id): id is string => typeof id === 'string' && candidateIds.has(id),
          ),
        ].filter((id) => id !== newId),
      ),
    );
    const { categories, categoryKeys } = normalizeCategoryState({
      categories: draft.categories || [],
    });

    const newConcept: Concept = {
      id: newId,
      title: draftTitle,
      summary: draftSummary || draftTitle,
      body: draftBody,
      sources: [],
      related: relatedIds,
      categories,
      categoryKeys,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const relatedDocs = repo.getConceptsByIds(relatedIds);
    const relatedDocsById = new Map(relatedDocs.map((c) => [c.id, c]));
    const biDirUpdates: Concept[] = [];
    for (const relId of relatedIds) {
      const concept = relatedDocsById.get(relId);
      if (!concept) continue;
      if (concept.related.includes(newId)) continue;
      const next: Concept = {
        ...concept,
        related: [...concept.related, newId],
        updatedAt: now,
      };
      biDirUpdates.push(next);
      relatedDocsById.set(relId, next);
    }

    const activity: ActivityLog = {
      id: 'a-' + nanoid(8),
      type: 'ingest',
      title: `从选段生成 <em>${escapeHTML(newConcept.title)}</em>`,
      details:
        parsed.activitySummary || `基于 ${relatedIds.length} 个相关概念整合，新建 1 个概念页`,
      relatedConceptIds: [newId, ...relatedIds],
      at: now,
    };

    const trx = getServerDb().transaction(() => {
      repo.upsertConcept(newConcept);
      for (const update of biDirUpdates) {
        repo.upsertConcept(update);
      }
      repo.insertActivity(activity);
    });
    trx();

    const affectedIds = Array.from(new Set([newId, ...biDirUpdates.map((c) => c.id)]));
    return NextResponse.json<SelectionWikiResponse>({
      status: 'created',
      conceptId: newId,
      concepts: repo.getConceptsByIds(affectedIds),
      activity,
    });
  } catch (err) {
    logger.error('selection_wiki.failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: '选段建页失败，请检查 API 配置或稍后重试。',
        requestId: getRequestContext()?.requestId,
      },
      { status: 500 },
    );
  }
});
