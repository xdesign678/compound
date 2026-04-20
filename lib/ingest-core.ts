/**
 * Shared ingest LLM logic — used by both:
 *   - `/api/ingest` route (original browser-driven flow)
 *   - `lib/server-ingest.ts` (new server-side GitHub sync flow)
 *
 * Only calls the LLM and shapes the response. Does NOT persist anything.
 */

import { chat, parseJSON } from './gateway';
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
const MAX_EXISTING = 500;

export async function runIngestLLM(input: IngestLLMInput): Promise<IngestResponse> {
  if (input.existingConcepts.length > MAX_EXISTING) {
    throw new Error(`Too many existing concepts (>${MAX_EXISTING})`);
  }

  const rawContent = input.source.rawContent.slice(0, MAX_RAW);

  const existingList = input.existingConcepts
    .map((c) => `- [${c.id}] ${c.title} — ${c.summary}`)
    .join('\n');

  const categoryList = input.existingCategories && input.existingCategories.length > 0
    ? `\n# 已有分类列表(请优先复用)\n\n${input.existingCategories.join(', ')}\n`
    : '';

  const userPrompt = `# 新资料

**标题**: ${input.source.title}
**类型**: ${input.source.type}
${input.source.author ? `**作者**: ${input.source.author}\n` : ''}${input.source.url ? `**来源**: ${input.source.url}\n` : ''}

**正文**:
${rawContent}

---

# 现有概念库(共 ${input.existingConcepts.length} 个)

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
  }

  return parsed;
}
