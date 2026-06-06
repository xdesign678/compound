/**
 * LLM-as-reranker.
 *
 * 在没有 cross-encoder 模型的情况下，把召回的 top-N 候选丢给一个低温 LLM 让它打
 * 0–10 的相关性分。这是 Microsoft / Anthropic / Cohere 在没有专用 reranker 时
 * 推荐的"poor man's reranker"，比 hybrid 召回直接拼 prompt 还是有显著精度提升。
 *
 * 失败时直接回落到原顺序，保证健壮性。
 */

import { RERANK_SYSTEM_PROMPT, RERANK_SYSTEM_PROMPT_VERSION } from '../prompts';
import { logger } from '../logging';
import { recordRagRerankOutcome, setRagRerankFailureRate } from '../observability/prometheus';
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
  /** Optional caller cancellation signal. Propagated to the underlying LLM call. */
  signal?: AbortSignal;
}

const MAX_CANDIDATES = 30;
const MAX_SNIPPET_CHARS = 600;
const MAX_TITLE_CHARS = 80;
const RERANK_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const RERANK_COOLDOWN_FAILURE_RATE = 0.3;
const RERANK_MIN_WINDOW_SAMPLES = 10;

interface RerankScore {
  id: string;
  score: number;
}

interface RerankAttempt {
  at: number;
  failed: boolean;
}

interface RerankGateway {
  chat: typeof import('../gateway').chat;
  parseJSON: typeof import('../gateway').parseJSON;
}

const rerankAttempts: RerankAttempt[] = [];
let gatewayForTests: RerankGateway | null = null;

function fallbackResult(
  candidates: RerankCandidate[],
  topK: number | undefined,
): { ranked: RerankCandidate[]; used: 'fallback' } {
  return {
    ranked: candidates.slice(0, topK ?? candidates.length),
    used: 'fallback',
  };
}

function pruneRerankAttempts(now: number): void {
  while (rerankAttempts.length > 0 && now - rerankAttempts[0].at > RERANK_FAILURE_WINDOW_MS) {
    rerankAttempts.shift();
  }
}

function getRerankFailureRate(now = Date.now()): number {
  pruneRerankAttempts(now);
  if (rerankAttempts.length === 0) return 0;
  return rerankAttempts.filter((attempt) => attempt.failed).length / rerankAttempts.length;
}

function recordRerankAttempt(failed: boolean, now = Date.now()): void {
  pruneRerankAttempts(now);
  rerankAttempts.push({ at: now, failed });
  setRagRerankFailureRate(getRerankFailureRate(now));
}

function shouldSkipRerank(now = Date.now()): boolean {
  const failureRate = getRerankFailureRate(now);
  setRagRerankFailureRate(failureRate);
  return (
    rerankAttempts.length >= RERANK_MIN_WINDOW_SAMPLES && failureRate > RERANK_COOLDOWN_FAILURE_RATE
  );
}

async function loadRerankGateway(): Promise<RerankGateway> {
  if (gatewayForTests) return gatewayForTests;
  const { chat, parseJSON } = await import('../gateway');
  return { chat, parseJSON };
}

export function resetRerankHealthForTests(): void {
  rerankAttempts.length = 0;
  gatewayForTests = null;
  setRagRerankFailureRate(0);
}

export function setRerankGatewayForTests(gateway: RerankGateway | null): void {
  gatewayForTests = gateway;
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
    recordRagRerankOutcome({ outcome: 'fallback' });
    setRagRerankFailureRate(getRerankFailureRate());
    return { ranked: [], used: 'fallback' };
  }
  if (process.env.COMPOUND_RERANK === 'off') {
    recordRagRerankOutcome({ outcome: 'fallback' });
    setRagRerankFailureRate(getRerankFailureRate());
    return fallbackResult(input.candidates, input.topK);
  }

  const candidates = input.candidates.slice(0, MAX_CANDIDATES);
  if (shouldSkipRerank()) {
    recordRagRerankOutcome({ outcome: 'cooldown' });
    return fallbackResult(candidates, input.topK);
  }

  try {
    const { chat, parseJSON } = await loadRerankGateway();
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
      promptVersion: RERANK_SYSTEM_PROMPT_VERSION,
      signal: input.signal,
    });
    const parsed = parseJSON<{ scores: RerankScore[] }>(raw);
    if (!Array.isArray(parsed?.scores)) {
      recordRerankAttempt(true);
      recordRagRerankOutcome({ outcome: 'fallback' });
      return fallbackResult(candidates, input.topK);
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
    recordRerankAttempt(false);
    recordRagRerankOutcome({ outcome: 'success' });
    return {
      ranked: ranked.slice(0, input.topK ?? ranked.length),
      used: 'llm',
    };
  } catch (error) {
    recordRerankAttempt(true);
    recordRagRerankOutcome({ outcome: 'fallback' });
    logger.warn('llm_rerank.failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackResult(candidates, input.topK);
  }
}
