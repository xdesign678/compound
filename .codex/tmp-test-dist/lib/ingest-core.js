"use strict";
/**
 * Shared ingest LLM logic — used by both:
 *   - `/api/ingest` route (original browser-driven flow)
 *   - `lib/server-ingest.ts` (new server-side GitHub sync flow)
 *
 * Only calls the LLM and shapes the response. Does NOT persist anything.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickExistingConceptsForPrompt = pickExistingConceptsForPrompt;
exports.runIngestLLM = runIngestLLM;
const gateway_1 = require("./gateway");
const category_normalization_1 = require("./category-normalization");
const prompts_1 = require("./prompts");
const MAX_RAW = 12000;
const MAX_EXISTING = 200;
function pickExistingConceptsForPrompt(input) {
    const { existingConcepts } = input;
    if (existingConcepts.length <= MAX_EXISTING)
        return existingConcepts;
    const sourceText = `${input.sourceTitle}\n${input.sourceRawContent.slice(0, MAX_RAW)}`.toLowerCase();
    const sourceKeywords = Array.from(new Set(sourceText
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2))).slice(0, 80);
    return existingConcepts
        .map((concept, index) => {
        const haystack = `${concept.title}\n${concept.summary}`.toLowerCase();
        let score = 0;
        if (concept.title && sourceText.includes(concept.title.toLowerCase()))
            score += 100;
        if (concept.summary && sourceText.includes(concept.summary.toLowerCase()))
            score += 40;
        for (const keyword of sourceKeywords) {
            if (!haystack.includes(keyword))
                continue;
            score += /[\u4e00-\u9fff]/.test(keyword) ? 8 : 4;
        }
        return { concept, index, score };
    })
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, MAX_EXISTING)
        .map((entry) => entry.concept);
}
async function runIngestLLM(input) {
    const rawContent = input.source.rawContent.slice(0, MAX_RAW);
    const promptConcepts = pickExistingConceptsForPrompt({
        sourceTitle: input.source.title,
        sourceRawContent: rawContent,
        existingConcepts: input.existingConcepts,
    });
    const existingList = promptConcepts
        .map((c) => `- [${c.id}] ${c.title} — ${c.summary}`)
        .join('\n');
    const normalizedExistingCategories = (0, category_normalization_1.normalizeCategoryKeys)(input.existingCategories ?? []);
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
    const raw = await (0, gateway_1.chat)({
        messages: [
            { role: 'system', content: prompts_1.INGEST_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
        ],
        responseFormat: 'json_object',
        temperature: 0.5,
        maxTokens: 4000,
        llmConfig: input.llmConfig,
    });
    const parsed = (0, gateway_1.parseJSON)(raw);
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
        c.categories = (0, category_normalization_1.normalizeCategoryState)({ categories: c.categories || [] }).categories;
    }
    return parsed;
}
