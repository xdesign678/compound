/**
 * Chinese-aware query tokenization for FTS5.
 *
 * Compound 的 `chunk_fts` / `concept_fts` 用 SQLite FTS5 自带的 unicode61
 * tokenizer，对中文等同于按字切分。但旧的 query 端却用
 * `[^a-z0-9\u4e00-\u9fff]+` 切分 + length>=2 过滤，导致大量整段中文 query 被
 * 误判成"无 term"，FTS recall 直接归零。
 *
 * 这里用 `@node-rs/jieba`（rust prebuilt 二进制，~5MB）在 query 端做分词，再
 * 把每个 term 用 `OR` 拼成 FTS5 表达式。索引侧仍是 unicode61 单字索引——
 * jieba 切出来的多字词在 FTS5 端会被当作短语 (`"用户体验"`) 匹配，召回更精准。
 *
 * Lazy-loads jieba on first use so test environments and code paths that
 * never query (e.g. the Next.js Edge bundles) don't pay the load cost.
 */

import { logger } from '../logging';

let jiebaSingleton: { cut(text: string): string[] } | null = null;
let jiebaInitFailed = false;

function getJieba(): { cut(text: string): string[] } | null {
  if (jiebaInitFailed) return null;
  if (jiebaSingleton) return jiebaSingleton;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@node-rs/jieba') as {
      Jieba: { withDict(dict: Buffer): { cut(text: string): string[] } };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dict } = require('@node-rs/jieba/dict') as { dict: Buffer };
    jiebaSingleton = mod.Jieba.withDict(dict);
    return jiebaSingleton;
  } catch (error) {
    jiebaInitFailed = true;
    logger.warn('jieba.init_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const STOPWORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '和',
  '就',
  '都',
  '与',
  '及',
  '或',
  '把',
  '被',
  '我',
  '你',
  '他',
  '她',
  '它',
  '们',
  '吗',
  '呢',
  '啊',
  '哦',
  '嗯',
  '请',
  '什么',
  '怎么',
  '为什么',
  '如何',
  '哪些',
  '哪个',
  '一下',
  '可以',
  '能否',
  '能不能',
  '应该',
  '需要',
  '关于',
  '对于',
  '比如',
  '例如',
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'on',
  'at',
  'by',
  'with',
  'how',
  'what',
  'why',
  'when',
  'where',
]);

function isAllPunct(token: string): boolean {
  return /^[\s\p{P}\p{S}]+$/u.test(token);
}

/**
 * Cut a query into search terms suitable for FTS5 OR matching.
 *
 * - Falls back to whitespace + length>=2 splitting if jieba fails to load.
 * - Drops stopwords, pure punctuation, single ASCII chars.
 * - Keeps single CJK chars only when query is very short (1 char query).
 * - Caps at `limit` to avoid blowing up SQL parameters.
 */
export function jiebaTokenize(query: string, limit = 12): string[] {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  const jieba = getJieba();
  let terms: string[];
  if (jieba) {
    terms = jieba.cut(trimmed.toLowerCase());
  } else {
    terms = trimmed
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .filter(Boolean);
  }

  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    if (isAllPunct(term)) continue;
    if (STOPWORDS.has(term)) continue;
    // Drop single ASCII chars (noise) but allow single CJK chars when no
    // longer alternative exists. We add singletons back only if cleaned is empty after the loop.
    if (term.length === 1 && /[a-z0-9]/i.test(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    cleaned.push(term);
    if (cleaned.length >= limit) break;
  }

  if (cleaned.length === 0) {
    // Last-resort fallback: keep CJK singletons so we still match *something*.
    for (const raw of terms) {
      const term = raw.trim();
      if (!term || isAllPunct(term) || STOPWORDS.has(term)) continue;
      if (seen.has(term)) continue;
      seen.add(term);
      cleaned.push(term);
      if (cleaned.length >= limit) break;
    }
  }

  return cleaned;
}

/**
 * Build an FTS5 MATCH expression from a query string. Quotes each term so
 * unicode61 tokenizer treats multi-char tokens as phrases (e.g. `"用户体验"`
 * matches the contiguous chars 用-户-体-验 in the indexed content).
 */
export function buildFtsMatchExpr(query: string, limit = 12): string {
  const terms = jiebaTokenize(query, limit);
  if (terms.length === 0) return '';
  return terms.map((term) => `"${term.replace(/"/g, '')}"`).join(' OR ');
}
