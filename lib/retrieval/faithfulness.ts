/**
 * Citation faithfulness check.
 *
 * 现行实现只校验 `citedConceptIds` 中的 id 真实存在；不校验回答正文里的
 * `[CX]` 编号是否真有对应的 concept 内容支撑。这里加一道轻量校验：
 * - 解析 answer 里出现的 `[C1] [C2] ...` 编号
 * - 对每个 cited concept，做"answer 中至少有一个相邻句子能在 concept body 里找到
 *   高重合 token"的本地启发式校验，不发起额外 LLM 调用以控成本
 * - 当本地启发式判定低分时，记录 warning 日志（可选触发 LLM 二次校验，由 env 控制）
 */

import { jiebaTokenize } from './jieba-tokenize';

export interface FaithfulnessInput {
  answer: string;
  citedConcepts: Array<{ id: string; title: string; summary: string; body: string }>;
}

export interface FaithfulnessResult {
  /** 0–1，1 = 全部引用都有 token-level 支撑 */
  score: number;
  /** 不可信的引用 id 列表 */
  unsupported: string[];
}

/**
 * Extract sentences (CN/EN) preceding each [CN] marker. Returns map
 * {citationIndex: surrounding sentence}.
 */
function extractCitationContexts(answer: string): Map<number, string> {
  const out = new Map<number, string>();
  const re = /\[C(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const index = Number(match[1]);
    if (!Number.isFinite(index)) continue;
    const before = answer.slice(0, match.index);
    // Take last sentence before the marker (CN: 。！？; EN: . ? !)
    const sentences = before.split(/(?<=[。！？!?\.])\s*/);
    const last = sentences[sentences.length - 1] || before.slice(-200);
    out.set(index, last.slice(-300));
  }
  return out;
}

function tokenSet(text: string): Set<string> {
  return new Set(jiebaTokenize(text, 40));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function checkFaithfulness(input: FaithfulnessInput): FaithfulnessResult {
  if (input.citedConcepts.length === 0) {
    return { score: 1, unsupported: [] };
  }
  const contexts = extractCitationContexts(input.answer);
  if (contexts.size === 0) {
    // No [CX] markers in the answer at all. Treat as low faithfulness signal
    // but don't fail outright — the prompt may have skipped citations.
    return { score: 0.5, unsupported: [] };
  }
  const unsupported: string[] = [];
  let supported = 0;
  for (const [index, citation] of contexts) {
    const concept = input.citedConcepts[index - 1]; // 1-indexed
    if (!concept) {
      unsupported.push(`C${index}`);
      continue;
    }
    const claimTokens = tokenSet(citation);
    const conceptTokens = tokenSet(`${concept.title}\n${concept.summary}\n${concept.body}`);
    const score = jaccard(claimTokens, conceptTokens);
    if (score >= 0.05) {
      supported += 1;
    } else {
      unsupported.push(concept.id);
    }
  }
  const total = contexts.size;
  return {
    score: total === 0 ? 1 : supported / total,
    unsupported,
  };
}
