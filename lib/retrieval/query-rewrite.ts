/**
 * History-aware query rewrite.
 *
 * 用户的多轮对话里大量出现指代词（"那它呢？""它和 RAG 比？""刚才说的那种方法"），
 * 但检索这一步看到的只有最新的一句问题。LangChain 的 `create_history_aware_retriever`
 * 同款做法：在检索前用一次低温 LLM 把问题改写成自包含的 query。
 *
 * 失败时直接回落到原 query，保证健壮性。
 */

import { QUERY_REWRITE_PROMPT } from '../prompts';
import { logger } from '../logging';
import type { LlmConfig } from '../types';

export interface QueryRewriteInput {
  question: string;
  history?: Array<{ role: 'user' | 'ai'; text: string }>;
  llmConfig?: LlmConfig;
  /** Override the model for the rewrite call; default is the cheap fallback. */
  rewriteModel?: string;
}

const MAX_HISTORY = 6;
const MAX_HISTORY_CHAR = 800;
const MAX_REWRITE_TOKENS = 200;

/**
 * Compose the user prompt for the rewrite call.
 */
function buildRewritePrompt(input: QueryRewriteInput): string {
  const history = (input.history ?? [])
    .slice(-MAX_HISTORY)
    .map(
      (turn) =>
        `${turn.role === 'user' ? '用户' : 'Wiki'}: ${turn.text.slice(0, MAX_HISTORY_CHAR)}`,
    )
    .join('\n');
  return [
    history ? `# 最近对话\n${history}` : '',
    `# 当前问题\n${input.question.trim()}`,
    '请直接输出改写后的 query 字符串，不要 JSON、不要解释。',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Quick heuristic to skip the LLM call when the question is already
 * self-contained. Saves latency / cost on the common case.
 *
 * Returns true when the question contains no Chinese pronouns / English
 * pronouns AND has no history (or history is irrelevant).
 */
function isSelfContained(question: string, history?: Array<{ text: string }>): boolean {
  if (!history || history.length === 0) return true;
  const probes = ['它', '他', '她', '这个', '那个', '这种', '那种', '上面', '刚才', '之前'];
  const englishProbes = /\b(it|its|they|their|that|this|those|these|them|the one|previously)\b/i;
  if (probes.some((p) => question.includes(p))) return false;
  if (englishProbes.test(question)) return false;
  return true;
}

export async function rewriteQuery(input: QueryRewriteInput): Promise<{
  rewritten: string;
  used: 'llm' | 'pass-through' | 'fallback';
}> {
  const original = input.question.trim();
  if (!original) return { rewritten: '', used: 'pass-through' };

  if (isSelfContained(original, input.history)) {
    return { rewritten: original, used: 'pass-through' };
  }

  if (process.env.COMPOUND_QUERY_REWRITE === 'off') {
    return { rewritten: original, used: 'pass-through' };
  }

  try {
    // Lazy import keeps test environments that don't exercise the LLM path
    // free of the gateway's transitive dependencies (model-runs uses nanoid).
    const { chat } = await import('../gateway');
    const raw = await chat({
      messages: [
        { role: 'system', content: QUERY_REWRITE_PROMPT },
        { role: 'user', content: buildRewritePrompt(input) },
      ],
      temperature: 0.1,
      maxTokens: MAX_REWRITE_TOKENS,
      llmConfig: input.llmConfig,
      model: input.rewriteModel || process.env.COMPOUND_QUERY_REWRITE_MODEL,
      task: 'query-rewrite',
    });
    const cleaned = raw
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^改写后的?\s*[:：]\s*/i, '')
      .split('\n')[0]
      .trim();
    if (!cleaned || cleaned.length > 400) {
      return { rewritten: original, used: 'fallback' };
    }
    return { rewritten: cleaned, used: 'llm' };
  } catch (error) {
    logger.warn('query_rewrite.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { rewritten: original, used: 'fallback' };
  }
}
