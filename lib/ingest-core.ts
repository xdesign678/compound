/**
 * Shared ingest LLM logic — used by both:
 *   - `/api/ingest` route (original browser-driven flow)
 *   - `lib/server-ingest.ts` (new server-side GitHub sync flow)
 *
 * Only calls the LLM and shapes the response. Does NOT persist anything.
 */

import { chat, parseJSON } from './gateway';
import { normalizeCategoryKeys, normalizeCategoryState } from './category-normalization';
import { INGEST_SYSTEM_PROMPT } from './prompts';
import type { IngestResponse, SourceType } from './types';

export interface IngestLLMInput {
  source: {
    title: string;
    type: SourceType;
    author?: string;
    url?: string;
    rawContent: string;
  };
  existingConcepts: Array<{ id: string; title: string; summary: string }>;
  existingCategories?: string[];
  llmConfig?: { apiKey?: string; apiUrl?: string; model?: string };
}

const MAX_RAW = 12000;
const MAX_EXISTING = 200;

interface ExistingConceptPromptItem {
  id: string;
  title: string;
  summary: string;
}

export function pickExistingConceptsForPrompt(input: {
  sourceTitle: string;
  sourceRawContent: string;
  existingConcepts: ExistingConceptPromptItem[];
}): ExistingConceptPromptItem[] {
  const { existingConcepts } = input;
  if (existingConcepts.length <= MAX_EXISTING) return existingConcepts;

  const sourceText = `${input.sourceTitle}\n${input.sourceRawContent.slice(0, MAX_RAW)}`.toLowerCase();
  const sourceKeywords = Array.from(
    new Set(
      sourceText
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2)
    )
  ).slice(0, 80);

  return existingConcepts
    .map((concept, index) => {
      const haystack = `${concept.title}\n${concept.summary}`.toLowerCase();
      let score = 0;

      if (concept.title && sourceText.includes(concept.title.toLowerCase())) score += 100;
      if (concept.summary && sourceText.includes(concept.summary.toLowerCase())) score += 40;

      for (const keyword of sourceKeywords) {
        if (!haystack.includes(keyword)) continue;
        score += /[\u4e00-\u9fff]/.test(keyword) ? 8 : 4;
      }

      return { concept, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_EXISTING)
    .map((entry) => entry.concept);
}

export async function runIngestLLM(input: IngestLLMInput): Promise<IngestResponse> {
  const rawContent = input.source.rawContent.slice(0, MAX_RAW);
  const promptConcepts = pickExistingConceptsForPrompt({
    sourceTitle: input.source.title,
    sourceRawContent: rawContent,
    existingConcepts: input.existingConcepts,
  });

  const existingList = promptConcepts
    .map((c) => `- [${c.id}] ${c.title} — ${c.summary}`)
    .join('\n');

  const normalizedExistingCategories = normalizeCategoryKeys(input.existingCategories ?? []);

  const categoryList = normalizedExistingCategories.length > 0
    ? `\n# 已有分类列表(请优先复用)\n\n${normalizedExistingCategories.join(', ')}\n`
    : '';

  const userPrompt = `# 新资料

**标题**: ${input.source.title}
**类型**: ${input.source.type}
${input.source.author ? `**作者**: ${input.source.author}\n` : ''}${input.source.url ? `**来源**: ${input.source.url}\n` : ''}

**正文**:
${rawContent}

---

# 现有概念库(本次提供 ${promptConcepts.length} / 共 ${input.existingConcepts.length} 个，已优先保留更相关和最近更新的概念)

${existingList || '(目前为空)'}

---
${categoryList}
请按 system prompt 定义的 JSON schema 输出编译结果。只输出 JSON,不要任何其它内容。`;

  const raw = await chat({
    messages: [
      { role: 'system', content: INGEST_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseFormat: 'json_object',
    temperature: 0.5,
    maxTokens: 4000,
    llmConfig: input.llmConfig,
  });

  const parsed = parseJSON<IngestResponse>(raw);

  // Defensive defaults
  parsed.newConcepts = parsed.newConcepts || [];
  parsed.updatedConcepts = parsed.updatedConcepts || [];
  parsed.activitySummary =
    parsed.activitySummary ||
    `新建 ${parsed.newConcepts.length} 个概念,更新 ${parsed.updatedConcepts.length} 个`;

  // Filter updatedConcepts to only reference existing IDs
  const existingIds = new Set(input.existingConcepts.map((c) => c.id));
  parsed.updatedConcepts = parsed.updatedConcepts.filter((u) => existingIds.has(u.id));

  // Filter relatedConceptIds in new concepts
  for (const c of parsed.newConcepts) {
    c.relatedConceptIds = (c.relatedConceptIds || []).filter((id) => existingIds.has(id));
    c.categories = normalizeCategoryState({ categories: c.categories || [] }).categories;
  }

  return parsed;
}
