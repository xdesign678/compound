import { nanoid } from 'nanoid';
import { chat, parseJSON } from './gateway';
import { SELECTION_WIKI_SYSTEM_PROMPT, SELECTION_WIKI_SYSTEM_PROMPT_VERSION } from './prompts';
import { getServerDb, repo } from './server-db';
import { normalizeCategoryKeys, normalizeCategoryState } from './category-normalization';
import { compileConceptArtifactsAfterManualChange } from './wiki-compiler';
import { wikiRepo } from './wiki-db';
import { escapeHTML } from './format';
import { logger } from './logging';
import { now, parseJson } from './utils';
import type {
  ActivityLog,
  CategoryTag,
  Concept,
  LlmConfig,
  SelectionWikiRequest,
  SelectionWikiResponse,
  SelectionWikiRunPhase,
  SelectionWikiRunStartResponse,
  SelectionWikiRunStatus,
  SelectionWikiRunStatusResponse,
} from './types';

const MAX_SELECTION_CHARS = 4_000;
const MIN_SELECTION_CHARS = 2;
const MAX_CONTEXT_TITLE_CHARS = 200;
const MAX_CANDIDATES = 32;
const MAX_CANDIDATE_BODY_CHARS = 1_200;

interface SelectionLLMConcept {
  title?: string;
  summary?: string;
  body?: string;
  relatedConceptIds?: string[];
  categories?: CategoryTag[];
}

interface SelectionLLMResponse {
  isDuplicate?: boolean;
  duplicateConceptId?: string | null;
  concept?: SelectionLLMConcept;
  activitySummary?: string;
}

interface SelectionWikiRunRow {
  id: string;
  status: SelectionWikiRunStatus;
  phase: SelectionWikiRunPhase;
  selection_preview: string;
  request_json: string;
  result_json: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
  updated_at: number;
}

export class SelectionWikiValidationError extends Error {
  readonly status = 400;
}

export function ensureSelectionWikiSchema(): void {
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS selection_wiki_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'queued',
      selection_preview TEXT NOT NULL DEFAULT '',
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_selection_wiki_runs_status
      ON selection_wiki_runs(status, started_at DESC);
  `);
}

export function createSelectionWikiRun(input: SelectionWikiRequest): string {
  ensureSelectionWikiSchema();
  const request = normalizeSelectionWikiRequest(input);
  const ts = now();
  const runId = `selection-wiki-${nanoid(10)}`;
  getServerDb()
    .prepare(
      `INSERT INTO selection_wiki_runs
          (id, status, phase, selection_preview, request_json, started_at, updated_at)
       VALUES (?, 'running', 'queued', ?, ?, ?, ?)`,
    )
    .run(runId, previewSelection(request.selection), JSON.stringify(request), ts, ts);
  return runId;
}

export function getSelectionWikiRunStart(runId: string): SelectionWikiRunStartResponse | null {
  const row = getSelectionWikiRunRow(runId);
  if (!row) return null;
  return {
    runId: row.id,
    status: 'running',
    phase: row.phase,
    selectionPreview: row.selection_preview,
    startedAt: row.started_at,
  };
}

export function getSelectionWikiRunStatus(runId: string): SelectionWikiRunStatusResponse | null {
  const row = getSelectionWikiRunRow(runId);
  if (!row) return null;
  return {
    runId: row.id,
    status: row.status,
    phase: row.phase,
    selectionPreview: row.selection_preview,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    result: row.result_json ? parseJson<SelectionWikiResponse | null>(row.result_json, null) : null,
  };
}

export function startSelectionWikiWorker(runId: string, llmConfig?: LlmConfig): void {
  ensureSelectionWikiSchema();
  const g = globalThis as unknown as {
    __compoundSelectionWikiWorkers?: Map<string, Promise<void>>;
  };
  if (!g.__compoundSelectionWikiWorkers) {
    g.__compoundSelectionWikiWorkers = new Map();
  }
  if (g.__compoundSelectionWikiWorkers.has(runId)) return;

  const task = runSelectionWikiWorker(runId, llmConfig)
    .catch((err) => {
      logger.error('selection_wiki.worker_crashed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      g.__compoundSelectionWikiWorkers?.delete(runId);
    });
  g.__compoundSelectionWikiWorkers.set(runId, task);
}

export function resumePendingSelectionWikiRuns(): void {
  ensureSelectionWikiSchema();
  const rows = getServerDb()
    .prepare(`SELECT id FROM selection_wiki_runs WHERE status = 'running'`)
    .all() as Array<{ id: string }>;
  for (const row of rows) {
    startSelectionWikiWorker(row.id);
  }
}

async function runSelectionWikiWorker(runId: string, llmConfig?: LlmConfig): Promise<void> {
  ensureSelectionWikiSchema();
  const row = getSelectionWikiRunRow(runId);
  if (!row || row.status !== 'running') return;

  try {
    const request = normalizeSelectionWikiRequest(
      parseJson<SelectionWikiRequest | null>(row.request_json, null),
    );
    const result = await createSelectionWikiResult(runId, request, llmConfig);
    getServerDb()
      .prepare(
        `UPDATE selection_wiki_runs
           SET status = 'done', phase = 'done', result_json = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(result), now(), now(), runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('selection_wiki.worker_failed', { runId, error: message });
    getServerDb()
      .prepare(
        `UPDATE selection_wiki_runs
           SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(message.slice(0, 500), now(), now(), runId);
  }
}

async function createSelectionWikiResult(
  runId: string,
  input: SelectionWikiRequest,
  llmConfig?: LlmConfig,
): Promise<SelectionWikiResponse> {
  const { selection, sourceConceptId, contextTitle } = input;

  setRunPhase(runId, 'loading_context');
  const searchText = `${contextTitle ?? ''}\n${selection}`;
  const rawCandidates = repo.findConceptCandidates(searchText, MAX_CANDIDATES * 2);
  const topCandidates = rawCandidates.slice(0, MAX_CANDIDATES);
  const fullCandidates = repo.getConceptsByIds(
    topCandidates.map((c) => c.id),
    { summariesOnly: false },
  );
  const candidateById = new Map(fullCandidates.map((c) => [c.id, c]));
  const candidates = topCandidates
    .map((c) => candidateById.get(c.id) ?? c)
    .filter((c): c is Concept => Boolean(c));
  const candidateIds = new Set(candidates.map((c) => c.id));

  const existingCategories = normalizeCategoryKeys(repo.listCategoryKeys());
  const categoryList =
    existingCategories.length > 0
      ? `\n# 已有分类列表(请优先复用)\n\n${existingCategories.join(', ')}\n`
      : '';

  const userPrompt = `# 用户选中的文字

${contextTitle ? `**所在概念**: ${contextTitle}\n` : ''}**选中正文**:
${selection}

---

# 现有相关概念(共 ${candidates.length} 条)

${buildCandidateBlock(candidates)}
${categoryList}
---

请基于「选中文字」综合生成一个全新的 Wiki 概念页;若现有相关概念里已有几乎等同的概念,把 isDuplicate 设为 true 并填入 duplicateConceptId。按 system prompt 的 JSON schema 输出,只输出 JSON。`;

  setRunPhase(runId, 'generating');
  const raw = await chat({
    messages: [
      { role: 'system', content: SELECTION_WIKI_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    responseFormat: 'json_object',
    temperature: 0.5,
    maxTokens: 2400,
    llmConfig,
    task: 'selection-wiki',
    promptVersion: SELECTION_WIKI_SYSTEM_PROMPT_VERSION,
  });

  const parsed = parseJSON<SelectionLLMResponse>(raw);
  const draft = parsed.concept ?? {};
  const draftTitle = clampString(draft.title, 60);
  const draftSummary = clampString(draft.summary, 240);
  const draftBody = typeof draft.body === 'string' ? draft.body.trim() : '';
  if (!draftTitle || !draftBody) {
    logger.warn('selection_wiki.empty_draft', {
      hasTitle: Boolean(draftTitle),
      hasBody: Boolean(draftBody),
    });
    throw new Error('LLM 未能生成有效的概念草稿，请稍后重试。');
  }

  setRunPhase(runId, 'persisting');
  const duplicateId =
    parsed.isDuplicate && typeof parsed.duplicateConceptId === 'string'
      ? parsed.duplicateConceptId.trim()
      : '';
  if (duplicateId && candidateById.has(duplicateId)) {
    const duplicate = candidateById.get(duplicateId)!;
    const activity: ActivityLog = {
      id: 'a-' + nanoid(8),
      type: 'ingest',
      title: `选段命中已有概念 <em>${escapeHTML(duplicate.title)}</em>`,
      details: parsed.activitySummary || '已有等价概念页，跳过新建',
      relatedConceptIds: [duplicate.id, ...(sourceConceptId ? [sourceConceptId] : [])],
      at: now(),
    };
    const trx = getServerDb().transaction(() => {
      if (sourceConceptId && sourceConceptId !== duplicate.id) {
        wikiRepo.upsertConceptRelation({
          sourceConceptId,
          targetConceptId: duplicate.id,
          kind: 'related',
          reason: '选段命中已有概念后同步来源概念关系。',
          confidence: 0.74,
        });
        wikiRepo.linkConceptPair(sourceConceptId, duplicate.id);
      }
      repo.insertActivity(activity);
    });
    trx();
    return {
      status: 'duplicate',
      conceptId: duplicate.id,
      concepts: repo.getConceptsByIds(
        Array.from(new Set([duplicate.id, ...(sourceConceptId ? [sourceConceptId] : [])])),
      ),
      activity,
    };
  }

  const ts = now();
  const newId = 'c-' + nanoid(8);
  const relatedIds = Array.from(
    new Set(
      [
        ...(sourceConceptId ? [sourceConceptId] : []),
        ...(draft.relatedConceptIds || []).filter(
          (id): id is string => typeof id === 'string' && candidateIds.has(id),
        ),
      ].filter((id) => id !== newId),
    ),
  );
  const { categories, categoryKeys } = normalizeCategoryState({
    categories: draft.categories || [],
  });

  const newConcept: Concept = {
    id: newId,
    title: draftTitle,
    summary: draftSummary || draftTitle,
    body: draftBody,
    sources: [],
    related: relatedIds,
    categories,
    categoryKeys,
    createdAt: ts,
    updatedAt: ts,
    version: 1,
  };

  const relatedDocs = repo.getConceptsByIds(relatedIds);
  const relatedDocsById = new Map(relatedDocs.map((c) => [c.id, c]));
  const previousRelatedDocsById = new Map(relatedDocs.map((c) => [c.id, c]));
  const biDirUpdates: Concept[] = [];
  for (const relId of relatedIds) {
    const concept = relatedDocsById.get(relId);
    if (!concept) continue;
    if (concept.related.includes(newId)) continue;
    const next: Concept = {
      ...concept,
      related: [...concept.related, newId],
      updatedAt: ts,
    };
    biDirUpdates.push(next);
    relatedDocsById.set(relId, next);
  }

  const activity: ActivityLog = {
    id: 'a-' + nanoid(8),
    type: 'ingest',
    title: `从选段生成 <em>${escapeHTML(newConcept.title)}</em>`,
    details: parsed.activitySummary || `基于 ${relatedIds.length} 个相关概念整合，新建 1 个概念页`,
    relatedConceptIds: [newId, ...relatedIds],
    at: ts,
  };

  const trx = getServerDb().transaction(() => {
    repo.upsertConcept(newConcept);
    for (const update of biDirUpdates) {
      repo.upsertConcept(update);
    }
    compileConceptArtifactsAfterManualChange({
      createdConcepts: [newConcept],
      updatedConcepts: biDirUpdates
        .map((next) => {
          const previous = previousRelatedDocsById.get(next.id);
          return previous ? { previous, next } : null;
        })
        .filter((pair): pair is { previous: Concept; next: Concept } => Boolean(pair)),
      sourceIds: [],
      changeSummary:
        parsed.activitySummary || `从选段生成「${newConcept.title}」并同步相关概念链接。`,
    });
    repo.insertActivity(activity);
  });
  trx();

  const affectedIds = Array.from(new Set([newId, ...biDirUpdates.map((c) => c.id)]));
  return {
    status: 'created',
    conceptId: newId,
    concepts: repo.getConceptsByIds(affectedIds),
    activity,
  };
}

function normalizeSelectionWikiRequest(input: SelectionWikiRequest | null): SelectionWikiRequest {
  const selection = clampString(input?.selection, MAX_SELECTION_CHARS);
  if (!selection || selection.length < MIN_SELECTION_CHARS) {
    throw new SelectionWikiValidationError(
      `selection must be at least ${MIN_SELECTION_CHARS} characters`,
    );
  }
  return {
    selection,
    sourceConceptId: clampString(input?.sourceConceptId, 80) || undefined,
    contextTitle: clampString(input?.contextTitle, MAX_CONTEXT_TITLE_CHARS) || undefined,
  };
}

function getSelectionWikiRunRow(runId: string): SelectionWikiRunRow | null {
  ensureSelectionWikiSchema();
  const row = getServerDb().prepare(`SELECT * FROM selection_wiki_runs WHERE id = ?`).get(runId) as
    | SelectionWikiRunRow
    | undefined;
  return row ?? null;
}

function setRunPhase(runId: string, phase: SelectionWikiRunPhase): void {
  getServerDb()
    .prepare(`UPDATE selection_wiki_runs SET phase = ?, updated_at = ? WHERE id = ?`)
    .run(phase, now(), runId);
}

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function previewSelection(selection: string): string {
  return selection.length > 36 ? `${selection.slice(0, 36)}...` : selection;
}

function buildCandidateBlock(candidates: Concept[]): string {
  if (candidates.length === 0) return '(目前为空)';
  return candidates
    .map((concept) => {
      const body = (concept.body || '').trim();
      const truncated =
        body.length > MAX_CANDIDATE_BODY_CHARS
          ? `${body.slice(0, MAX_CANDIDATE_BODY_CHARS)}...`
          : body;
      return `- [${concept.id}] ${concept.title}\n  摘要: ${concept.summary}\n  正文摘录:\n  ${truncated || '(无正文)'}`;
    })
    .join('\n\n');
}
