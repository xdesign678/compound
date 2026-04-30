/**
 * LLM-as-reranker.
 *
 * 在没有 cross-encoder 模型的情况下，把召回的 top-N 候选丢给一个低温 LLM 让它打
 * 0–10 的相关性分。这是 Microsoft / Anthropic / Cohere 在没有专用 reranker 时
 * 推荐的"poor man's reranker"，比 hybrid 召回直接拼 prompt 还是有显著精度提升。
 *
 * 失败时直接回落到原顺序，保证健壮性。
 */

import { RERANK_SYSTEM_PROMPT } from '../prompts';
import { logger } from '../logging';
import type { LlmConfig } from '../types';

export interface RerankCandidate {
  /** Stable id used in scoring. */
  id: string;
  /** Short kind label: "concept" | "chunk" | "graph" — for prompt context only. */
  kind: string;
  /** Title or short label. */
  title: string;
  /** Body / content snippet. Will be truncated to ~600 chars. */
  snippet: string;
}

export interface RerankInput {
  query: string;
  candidates: RerankCandidate[];
  topK?: number;
  llmConfig?: LlmConfig;
  rerankModel?: string;
}

const MAX_CANDIDATES = 30;
const MAX_SNIPPET_CHARS = 600;
const MAX_TITLE_CHARS = 80;

interface RerankScore {
  id: string;
  score: number;
}

function buildRerankPrompt(query: string, candidates: RerankCandidate[]): string {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. [${c.kind}] id=${c.id}\n标题：${c.title.slice(0, MAX_TITLE_CHARS)}\n内容：${c.snippet
          .replace(/\s+/g, ' ')
          .slice(0, MAX_SNIPPET_CHARS)}`,
    )
    .join('\n\n');
  return `# 用户问题\n${query}\n\n# 候选片段\n\n${list}\n\n请按 system prompt 的 JSON schema 给出排序，只输出 JSON。`;
}

export async function llmRerank(input: RerankInput): Promise<{
  ranked: RerankCandidate[];
  used: 'llm' | 'fallback';
}> {
  if (input.candidates.length === 0) {
    return { ranked: [], used: 'fallback' };
  }
  if (process.env.COMPOUND_RERANK === 'off') {
    return {
      ranked: input.candidates.slice(0, input.topK ?? input.candidates.length),
      used: 'fallback',
    };
  }

  const candidates = input.candidates.slice(0, MAX_CANDIDATES);

  try {
    const { chat, parseJSON } = await import('../gateway');
    const raw = await chat({
      messages: [
        { role: 'system', content: RERANK_SYSTEM_PROMPT },
        { role: 'user', content: buildRerankPrompt(input.query, candidates) },
      ],
      responseFormat: 'json_object',
      temperature: 0.1,
      maxTokens: 800,
      llmConfig: input.llmConfig,
      model: input.rerankModel || process.env.COMPOUND_RERANK_MODEL,
      task: 'rerank',
    });
    const parsed = parseJSON<{ scores: RerankScore[] }>(raw);
    if (!Array.isArray(parsed?.scores)) {
      return {
        ranked: candidates.slice(0, input.topK ?? candidates.length),
        used: 'fallback',
      };
    }
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const ranked = parsed.scores
      .filter((s) => byId.has(s.id) && Number.isFinite(s.score))
      .sort((a, b) => b.score - a.score)
      .map((s) => byId.get(s.id))
      .filter((c): c is RerankCandidate => Boolean(c));

    // Append candidates that the LLM forgot to score, preserving original order
    const seen = new Set(ranked.map((c) => c.id));
    for (const c of candidates) {
      if (!seen.has(c.id)) ranked.push(c);
    }
    return {
      ranked: ranked.slice(0, input.topK ?? ranked.length),
      used: 'llm',
    };
  } catch (error) {
    logger.warn('llm_rerank.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ranked: candidates.slice(0, input.topK ?? candidates.length),
      used: 'fallback',
    };
  }
}
