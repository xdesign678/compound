import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { chat, parseJSON } from './gateway';
import { CATEGORY_WIKI_SYSTEM_PROMPT, CATEGORY_WIKI_SYSTEM_PROMPT_VERSION } from './prompts';
import { getServerDb, repo, rowToCategoryWiki } from './server-db';
import { logger } from './logging';
import { now, parseJson } from './utils';
import type {
  CategoryWiki,
  CategoryWikiRequest,
  CategoryWikiRunPhase,
  CategoryWikiRunStartResponse,
  CategoryWikiRunStatus,
  CategoryWikiRunStatusResponse,
  Concept,
  LlmConfig,
} from './types';

const MAX_CONCEPTS_PER_WIKI = 80;
const MAX_CANDIDATE_BODY_CHARS = 600;

interface CategoryWikiLLMResponse {
  bodyMd: string;
  activitySummary?: string;
}

interface CategoryWikiRunRow {
  id: string;
  primary_category: string;
  secondary_category: string;
  status: CategoryWikiRunStatus;
  phase: CategoryWikiRunPhase;
  request_json: string;
  result_json: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  updated_at: number;
}

export function ensureCategoryWikiSchema(): void {
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS category_wiki_runs (
      id TEXT PRIMARY KEY,
      primary_category TEXT NOT NULL,
      secondary_category TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'queued',
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_category_wiki_runs_status
      ON category_wiki_runs(status, started_at DESC);
  `);
}

export function computeConceptIdsHash(concepts: Array<{ id: string; updatedAt: number }>): string {
  const payload = concepts
    .map((c) => `${c.id}|${c.updatedAt}`)
    .sort()
    .join('\n');
  return createHash('sha1').update(payload).digest('hex').slice(0, 20);
}

export function getCategoryWiki(primary: string, secondary: string): CategoryWiki | null {
  ensureCategoryWikiSchema();
  const row = repo.getCategoryWiki(primary, secondary);
  return row ? rowToCategoryWiki(row) : null;
}

export function createCategoryWikiRun(input: CategoryWikiRequest): string {
  ensureCategoryWikiSchema();
  const ts = now();
  const runId = `cw-${nanoid(10)}`;

  const existing = getActiveRunForCategory(input.primary, input.secondary);
  if (existing) return existing.id;

  getServerDb()
    .prepare(
      `INSERT INTO category_wiki_runs
        (id, primary_category, secondary_category, status, phase, request_json, started_at, updated_at)
       VALUES (?, ?, ?, 'running', 'queued', ?, ?, ?)`,
    )
    .run(runId, input.primary, input.secondary, JSON.stringify(input), ts, ts);
  return runId;
}

export function getCategoryWikiRunStart(runId: string): CategoryWikiRunStartResponse | null {
  const row = getRunRow(runId);
  if (!row) return null;
  return {
    runId: row.id,
    status: 'running',
    phase: row.phase,
    startedAt: row.started_at,
  };
}

export function getCategoryWikiRunStatus(runId: string): CategoryWikiRunStatusResponse | null {
  const row = getRunRow(runId);
  if (!row) return null;
  return {
    runId: row.id,
    status: row.status,
    phase: row.phase,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

export function startCategoryWikiWorker(runId: string, llmConfig?: LlmConfig): void {
  ensureCategoryWikiSchema();
  const g = globalThis as unknown as {
    __compoundCategoryWikiWorkers?: Map<string, Promise<void>>;
  };
  if (!g.__compoundCategoryWikiWorkers) {
    g.__compoundCategoryWikiWorkers = new Map();
  }
  if (g.__compoundCategoryWikiWorkers.has(runId)) return;

  const task = runCategoryWikiWorker(runId, llmConfig)
    .catch((err) => {
      logger.error('category_wiki.worker_crashed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      g.__compoundCategoryWikiWorkers?.delete(runId);
    });
  g.__compoundCategoryWikiWorkers.set(runId, task);
}

export function resumePendingCategoryWikiRuns(): void {
  ensureCategoryWikiSchema();
  const rows = getServerDb()
    .prepare(`SELECT id FROM category_wiki_runs WHERE status = 'running'`)
    .all() as Array<{ id: string }>;
  for (const row of rows) {
    startCategoryWikiWorker(row.id);
  }
}

export function markCategoryWikisStaleByConceptIds(conceptIds: string[]): number {
  if (conceptIds.length === 0) return 0;
  const placeholders = conceptIds.map(() => '?').join(',');
  const rows = getServerDb()
    .prepare(`SELECT DISTINCT categories FROM concepts WHERE id IN (${placeholders})`)
    .all(...conceptIds) as Array<{ categories: string }>;

  const pairs: Array<{ primary: string; secondary: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const cats = parseJson<Array<{ primary: string; secondary?: string }>>(row.categories, []);
    for (const cat of cats) {
      if (!cat.primary || !cat.secondary) continue;
      const key = `${cat.primary}/${cat.secondary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ primary: cat.primary, secondary: cat.secondary });
    }
  }
  return repo.markCategoryWikisStale(pairs);
}

function getActiveRunForCategory(primary: string, secondary: string): CategoryWikiRunRow | null {
  const row = getServerDb()
    .prepare(
      `SELECT * FROM category_wiki_runs
       WHERE primary_category = ? AND secondary_category = ? AND status = 'running'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(primary, secondary) as CategoryWikiRunRow | undefined;
  return row ?? null;
}

async function runCategoryWikiWorker(runId: string, llmConfig?: LlmConfig): Promise<void> {
  ensureCategoryWikiSchema();
  const row = getRunRow(runId);
  if (!row || row.status !== 'running') return;

  try {
    const request = parseJson<CategoryWikiRequest | null>(row.request_json, null);
    if (!request?.primary || !request.secondary) {
      throw new Error('缺少 primary 或 secondary 参数');
    }

    const result = await generateCategoryWiki(runId, request, llmConfig);

    const ts = now();
    getServerDb()
      .prepare(
        `UPDATE category_wiki_runs
         SET status = 'done', phase = 'done', result_json = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify({ success: true }), ts, ts, runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('category_wiki.worker_failed', { runId, error: message });
    getServerDb()
      .prepare(
        `UPDATE category_wiki_runs
         SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(message.slice(0, 500), now(), now(), runId);
  }
}

async function generateCategoryWiki(
  runId: string,
  input: CategoryWikiRequest,
  llmConfig?: LlmConfig,
): Promise<{ wikiId: string }> {
  setRunPhase(runId, 'loading_context');

  const concepts = repo.listConceptsByCategory(
    input.primary,
    input.secondary,
    MAX_CONCEPTS_PER_WIKI,
  );
  if (concepts.length === 0) {
    throw new Error(`「${input.primary} > ${input.secondary}」下没有概念，无法生成 Wiki`);
  }

  const conceptIdsHash = computeConceptIdsHash(concepts);
  const conceptBlock = buildConceptBlock(concepts);

  const userPrompt = `# 主题: ${input.primary} > ${input.secondary}

以下是该主题下的 ${concepts.length} 个概念:

${conceptBlock}

请基于以上概念，生成一份完整、连贯的 Wiki 长文。`;

  setRunPhase(runId, 'generating');

  const raw = await chat({
    messages: [
      { role: 'system', content: CATEGORY_WIKI_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseFormat: 'json_object',
    temperature: 0.45,
    maxTokens: 4000,
    llmConfig,
    task: 'category-wiki',
    promptVersion: CATEGORY_WIKI_SYSTEM_PROMPT_VERSION,
  });

  const parsed = parseJSON<CategoryWikiLLMResponse>(raw);
  const bodyMd = typeof parsed.bodyMd === 'string' ? parsed.bodyMd.trim() : '';
  if (!bodyMd) {
    throw new Error('LLM 未能生成有效的 Wiki 正文');
  }

  setRunPhase(runId, 'persisting');

  const tocJson = extractTocFromMarkdown(bodyMd);
  const wikiId = `cw-${nanoid(8)}`;
  const ts = now();

  repo.upsertCategoryWiki({
    id: wikiId,
    primaryCategory: input.primary,
    secondaryCategory: input.secondary,
    bodyMd,
    tocJson: JSON.stringify(tocJson),
    conceptIds: concepts.map((c) => c.id),
    conceptIdsHash,
    model: llmConfig?.model,
    promptVersion: CATEGORY_WIKI_SYSTEM_PROMPT_VERSION,
    generatedAt: ts,
  });

  logger.info('category_wiki.generated', {
    wikiId,
    primary: input.primary,
    secondary: input.secondary,
    conceptCount: concepts.length,
    bodyLength: bodyMd.length,
  });

  return { wikiId };
}

function getRunRow(runId: string): CategoryWikiRunRow | null {
  ensureCategoryWikiSchema();
  const row = getServerDb().prepare(`SELECT * FROM category_wiki_runs WHERE id = ?`).get(runId) as
    | CategoryWikiRunRow
    | undefined;
  return row ?? null;
}

function setRunPhase(runId: string, phase: CategoryWikiRunPhase): void {
  getServerDb()
    .prepare(`UPDATE category_wiki_runs SET phase = ?, updated_at = ? WHERE id = ?`)
    .run(phase, now(), runId);
}

function buildConceptBlock(concepts: Concept[]): string {
  return concepts
    .map((c) => {
      const body = (c.body || c.summary || '').trim();
      const truncated =
        body.length > MAX_CANDIDATE_BODY_CHARS
          ? `${body.slice(0, MAX_CANDIDATE_BODY_CHARS)}...`
          : body;
      return `- [${c.id}] **${c.title}**: ${c.summary}\n  正文摘录: ${truncated || '(无)'}`;
    })
    .join('\n\n');
}

interface TocItem {
  level: number;
  title: string;
}

function extractTocFromMarkdown(md: string): TocItem[] {
  const items: TocItem[] = [];
  const lines = md.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)/);
    if (match) {
      items.push({
        level: match[1].length,
        title: match[2].trim(),
      });
    }
  }
  return items;
}
