/**
 * Health 深度检查的后端异步 worker。
 *
 * 把 lint 从同步 POST（客户端等响应）改为异步 run 模式：
 *  1. 客户端 POST /api/lint/run → 服务端创建 run，启动后台 worker
 *  2. 客户端轮询 GET /api/lint/status?runId=... → 获取实时进度和结果
 *
 * 进度分阶段：loading_concepts → analyzing → done | failed。
 * 客户端断开也不影响，回来可以继续看结果。
 */

import { nanoid } from 'nanoid';
import { chat, parseJSON } from './gateway';
import { LINT_SYSTEM_PROMPT, LINT_SYSTEM_PROMPT_VERSION } from './prompts';
import { getServerDb, repo } from './server-db';
import { now, parseJson } from './utils';
import { logger } from './logging';
import type { Concept, LlmConfig } from './types';

export type LintRunPhase = 'loading_concepts' | 'analyzing' | 'done';
export type LintRunStatus = 'running' | 'done' | 'failed';

export interface LintFinding {
  type: 'contradiction' | 'orphan' | 'missing-link' | 'duplicate';
  message: string;
  conceptIds: string[];
}

export interface LintRunRow {
  id: string;
  status: LintRunStatus;
  phase: string;
  concept_count: number;
  started_at: number;
  finished_at: number | null;
  findings_json: string | null;
  error: string | null;
}

export interface LintRunStatusResponse {
  id: string;
  status: LintRunStatus;
  phase: LintRunPhase;
  conceptCount: number;
  findings: LintFinding[];
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

const MAX_CONCEPTS = Math.max(
  100,
  Math.min(1500, Number(process.env.COMPOUND_LINT_MAX_CONCEPTS || 800)),
);
const LINT_FINDING_LIMIT = 8;
const LINT_DEFAULT_BATCH_SIZE = 120;
const LINT_DEFAULT_MAX_TOKENS = 6000;
const LINT_SUMMARY_MAX_CHARS = 220;
const LINT_RELATED_LIMIT = 12;
const LINT_FINDING_TYPES = new Set<LintFinding['type']>([
  'contradiction',
  'orphan',
  'missing-link',
  'duplicate',
]);

type LintConceptInput = Pick<Concept, 'id' | 'title' | 'summary' | 'related'>;

export function ensureLintSchema(): void {
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS lint_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'loading_concepts',
      concept_count INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      findings_json TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lint_runs_status ON lint_runs(status, started_at DESC);
  `);
}

export function createLintRun(): string {
  ensureLintSchema();
  const runId = `lint-${nanoid(10)}`;
  const ts = now();
  getServerDb()
    .prepare(
      `INSERT INTO lint_runs (id, status, phase, concept_count, started_at)
       VALUES (?, 'running', 'loading_concepts', 0, ?)`,
    )
    .run(runId, ts);
  return runId;
}

export function getLintRunStatus(runId: string): LintRunStatusResponse | null {
  ensureLintSchema();
  const row = getServerDb().prepare(`SELECT * FROM lint_runs WHERE id = ?`).get(runId) as
    | LintRunRow
    | undefined;
  if (!row) return null;

  const findings = row.findings_json ? parseJson<LintFinding[]>(row.findings_json, []) : [];

  return {
    id: row.id,
    status: row.status as LintRunStatus,
    phase: row.phase as LintRunPhase,
    conceptCount: row.concept_count,
    findings,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

function setPhase(runId: string, phase: LintRunPhase, conceptCount?: number): void {
  const stmt = getServerDb().prepare(
    `UPDATE lint_runs SET phase = ?, concept_count = ? WHERE id = ?`,
  );
  stmt.run(phase, conceptCount ?? 0, runId);
}

function readClampedPositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function getLintBatchSize(): number {
  return readClampedPositiveInt(process.env.COMPOUND_LINT_BATCH_SIZE, LINT_DEFAULT_BATCH_SIZE, 300);
}

function getLintMaxTokens(): number {
  return Math.max(
    4000,
    readClampedPositiveInt(process.env.COMPOUND_LINT_MAX_TOKENS, LINT_DEFAULT_MAX_TOKENS, 16_000),
  );
}

function truncateInline(value: string | undefined, maxChars: number): string {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatLintConcept(concept: LintConceptInput): string {
  const related = concept.related.slice(0, LINT_RELATED_LIMIT);
  const remainingRelated = concept.related.length - related.length;
  const relatedText =
    related.length > 0
      ? `${related.join(', ')}${remainingRelated > 0 ? `, ...(+${remainingRelated})` : ''}`
      : '(none)';

  return `[${concept.id}] ${concept.title}
  summary: ${truncateInline(concept.summary, LINT_SUMMARY_MAX_CHARS) || '(empty)'}
  related: ${relatedText}`;
}

function chunkConcepts<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildLintUserPrompt(
  concepts: LintConceptInput[],
  batchIndex: number,
  batchCount: number,
): string {
  const listing = concepts.map(formatLintConcept).join('\n\n');
  const batchContext =
    batchCount > 1
      ? `\n\n本次是全量深度检查的第 ${batchIndex + 1}/${batchCount} 批。只基于本批概念返回最重要的问题，不要引用本批未出现的 concept id。`
      : '';

  return `# 当前 Wiki 的概念索引

${listing}

---${batchContext}

请按 system prompt 定义的 JSON schema 输出 lint 发现,只输出 JSON。`;
}

function normalizeLintFindings(
  findings: Array<Partial<LintFinding>>,
  validIds: Set<string>,
): LintFinding[] {
  const normalized: LintFinding[] = [];
  for (const finding of findings) {
    if (!finding || !finding.type || !LINT_FINDING_TYPES.has(finding.type)) continue;
    const conceptIds = Array.from(
      new Set((finding.conceptIds ?? []).filter((id) => validIds.has(id))),
    );
    if (conceptIds.length === 0) continue;
    normalized.push({
      type: finding.type,
      message:
        typeof finding.message === 'string' && finding.message.trim()
          ? finding.message.trim().slice(0, 300)
          : '深度检查发现一个需要关注的问题',
      conceptIds,
    });
  }
  return normalized;
}

async function analyzeLintBatch(
  concepts: LintConceptInput[],
  batchIndex: number,
  batchCount: number,
  llmConfig?: LlmConfig,
): Promise<Array<Partial<LintFinding>>> {
  const raw = await chat({
    messages: [
      { role: 'system', content: LINT_SYSTEM_PROMPT },
      { role: 'user', content: buildLintUserPrompt(concepts, batchIndex, batchCount) },
    ],
    responseFormat: 'json_object',
    temperature: 0.3,
    maxTokens: getLintMaxTokens(),
    llmConfig,
    task: 'lint',
    promptVersion: LINT_SYSTEM_PROMPT_VERSION,
  });

  const parsed = parseJSON<{ findings?: Array<Partial<LintFinding>> }>(raw);
  return parsed.findings ?? [];
}

export async function analyzeLintConcepts(
  concepts: LintConceptInput[],
  llmConfig?: LlmConfig,
): Promise<LintFinding[]> {
  if (concepts.length === 0) return [];

  const validIds = new Set(concepts.map((concept) => concept.id));
  const batchSize = getLintBatchSize();
  const batches = chunkConcepts(concepts, batchSize);
  const findings: LintFinding[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < batches.length; index += 1) {
    const batchFindings = normalizeLintFindings(
      await analyzeLintBatch(batches[index], index, batches.length, llmConfig),
      validIds,
    );
    for (const finding of batchFindings) {
      const key = `${finding.type}:${finding.conceptIds.slice().sort().join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(finding);
    }
  }

  return findings.slice(0, LINT_FINDING_LIMIT);
}

async function runLintWorker(runId: string, llmConfig?: LlmConfig): Promise<void> {
  ensureLintSchema();

  try {
    // Phase 1: load concepts from server DB
    setPhase(runId, 'loading_concepts');
    const concepts = repo.listConcepts({ summariesOnly: true });
    const sliced = concepts.slice(0, MAX_CONCEPTS);
    setPhase(runId, 'loading_concepts', sliced.length);

    if (sliced.length === 0) {
      getServerDb()
        .prepare(
          `UPDATE lint_runs SET status = 'done', phase = 'done', finished_at = ?, findings_json = ? WHERE id = ?`,
        )
        .run(now(), JSON.stringify([]), runId);
      return;
    }

    // Phase 2: LLM analysis
    setPhase(runId, 'analyzing', sliced.length);

    const findings = await analyzeLintConcepts(sliced, llmConfig);

    // Phase 3: done
    getServerDb()
      .prepare(
        `UPDATE lint_runs SET status = 'done', phase = 'done', finished_at = ?, findings_json = ? WHERE id = ?`,
      )
      .run(now(), JSON.stringify(findings), runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('lint.worker_failed', { runId, error: message });
    getServerDb()
      .prepare(
        `UPDATE lint_runs SET status = 'failed', phase = 'loading_concepts', finished_at = ?, error = ? WHERE id = ?`,
      )
      .run(now(), message.slice(0, 500), runId);
  }
}

/**
 * Fire-and-forget: start the lint worker for a run.
 * Survives server restarts — the status route revives pending runs.
 */
export function startLintWorker(runId: string, llmConfig?: LlmConfig): void {
  ensureLintSchema();
  const g = globalThis as unknown as { __compoundLintWorkers?: Map<string, Promise<void>> };
  if (!g.__compoundLintWorkers) g.__compoundLintWorkers = new Map();
  if (g.__compoundLintWorkers.has(runId)) return;

  const task = runLintWorker(runId, llmConfig)
    .catch((err) => {
      logger.error('lint.worker_crashed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      g.__compoundLintWorkers?.delete(runId);
    });
  g.__compoundLintWorkers.set(runId, task);
}

/** Resume any still-running lint runs after a server restart. */
export function resumePendingLintRuns(): void {
  ensureLintSchema();
  const rows = getServerDb()
    .prepare(`SELECT id FROM lint_runs WHERE status = 'running'`)
    .all() as Array<{ id: string }>;
  for (const row of rows) {
    startLintWorker(row.id);
  }
}
