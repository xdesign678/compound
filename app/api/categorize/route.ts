import { NextResponse } from 'next/server';
import { chat, parseJSON } from '@/lib/gateway';
import { CATEGORIZE_SYSTEM_PROMPT } from '@/lib/prompts';
import type { CategorizeRequest, CategorizeResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CategorizeRequest;
    if (!Array.isArray(body.concepts) || body.concepts.length === 0) {
      return NextResponse.json({ error: 'concepts array is required' }, { status: 400 });
    }
    if (body.concepts.length > 20) {
      return NextResponse.json({ error: 'Max 20 concepts per batch' }, { status: 400 });
    }

    const apiKey = req.headers.get('x-user-api-key') || undefined;
    const apiUrl = req.headers.get('x-user-api-url') || undefined;
    const model = req.headers.get('x-user-model') || undefined;
    const llmConfig = (apiKey || apiUrl || model) ? { apiKey, apiUrl, model } : body.llmConfig;

    const conceptList = body.concepts
      .map((c) => `- [${c.id}] ${c.title} — ${c.summary}\n  正文片段: ${c.body.slice(0, 200)}`)
      .join('\n');

    const categoryList = body.existingCategories.length > 0
      ? body.existingCategories.join(', ')
      : '(暂无已有分类)';

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

    // Only return results for IDs that were actually requested
    const requestedIds = new Set(body.concepts.map((c) => c.id));
    parsed.results = parsed.results.filter((r) => requestedIds.has(r.id));

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[categorize] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'Categorize failed. Check API config.' }, { status: 500 });
  }
}
