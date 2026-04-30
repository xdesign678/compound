/**
 * Anthropic-style Contextual Retrieval.
 *
 * 入库时给每个 chunk 用低温 LLM 生成 50–100 字"情境前缀"，再把 prefix + chunk
 * 喂给 BM25 / 向量索引。Anthropic 实测 top-20 召回失败率降 49%，加 reranker 共
 * 降 67%。文件出处：
 * https://www.anthropic.com/news/contextual-retrieval
 *
 * 这里的实现策略：
 * - 单 chunk → 单次 LLM 调用（依赖底层 prompt cache 摊薄成本）
 * - 失败/超时 → 返回空字符串（即等同于不带 prefix，回落到旧行为）
 * - 长文档（>32k chars）只取首尾片段做情境，避免单次调用爆 token
 */

import { CONTEXTUALIZE_CHUNK_PROMPT } from './prompts';
import { logger } from './logging';
import type { LlmConfig } from './types';

export interface ContextualizeChunkInput {
  fullDocument: string;
  documentTitle: string;
  chunk: string;
  llmConfig?: LlmConfig;
  contextualizeModel?: string;
}

const MAX_DOC_CHARS = 32_000;
const MAX_CHUNK_CHARS = 4_000;
const MAX_PREFIX_TOKENS = 200;

function buildPrompt(input: ContextualizeChunkInput): string {
  let doc = input.fullDocument;
  if (doc.length > MAX_DOC_CHARS) {
    const head = doc.slice(0, Math.floor(MAX_DOC_CHARS * 0.7));
    const tail = doc.slice(-Math.floor(MAX_DOC_CHARS * 0.3));
    doc = `${head}\n\n... [中间省略 ${doc.length - MAX_DOC_CHARS} 字] ...\n\n${tail}`;
  }
  const chunk = input.chunk.slice(0, MAX_CHUNK_CHARS);
  return `# 资料标题\n${input.documentTitle}\n\n# 完整原文\n<document>\n${doc}\n</document>\n\n# 当前 chunk\n<chunk>\n${chunk}\n</chunk>\n\n请按 system prompt 的规则，输出 50–100 字的中文情境前缀。`;
}

export async function contextualizeChunk(input: ContextualizeChunkInput): Promise<string> {
  if (process.env.COMPOUND_CONTEXTUAL_RETRIEVAL === 'off') return '';
  if (!input.chunk?.trim()) return '';

  try {
    const { chat } = await import('./gateway');
    const raw = await chat({
      messages: [
        { role: 'system', content: CONTEXTUALIZE_CHUNK_PROMPT },
        { role: 'user', content: buildPrompt(input) },
      ],
      temperature: 0.1,
      maxTokens: MAX_PREFIX_TOKENS,
      llmConfig: input.llmConfig,
      model: input.contextualizeModel || process.env.COMPOUND_CONTEXTUALIZE_MODEL,
      task: 'contextualize-chunk',
    });
    const cleaned = raw
      .trim()
      .replace(/^```[\w-]*\n?|\n?```$/g, '')
      .trim();
    if (!cleaned) return '';
    // Sanity cap: 50–200 chars to avoid runaway model output
    return cleaned.slice(0, 200);
  } catch (error) {
    logger.warn('contextualize_chunk.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
