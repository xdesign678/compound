/**
 * Health 深度检查一键修复的后端队列。
 *
 * 四种 finding → job 映射:
 *   duplicate    → merge      (LLM 合并两页,反向引用迁移,删除 secondary)
 *   missing-link → link       (双向 related 互加,无需 LLM)
 *   orphan       → orphan     (LLM 从候选里挑 ≤3 个,双向互加)
 *   contradiction → conflict  (LLM 裁定段追加 + 入 review_items)
 *
 * 任务状态机: queued → running → done | failed | skipped。
 * 同一 conceptId 不能同时被多个 job 锁(以 run-level 内存 set 防并发)。
 */
import { nanoid } from 'nanoid';
import { chat, parseJSON } from './gateway';
import { CONFLICT_SYSTEM_PROMPT, MERGE_SYSTEM_PROMPT, ORPHAN_SYSTEM_PROMPT } from './prompts';
import { createReviewItem } from './review-queue';
import { getServerDb, repo } from './server-db';
import { now, parseJson } from './utils';
import type { ActivityLog, Concept } from './types';

export type RepairJobKind = 'merge' | 'link' | 'orphan' | 'conflict';
export type RepairJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';
export type RepairRunStatus = 'running' | 'done' | 'failed' | 'cancelled';

export interface RepairFindingInput {
  type: 'duplicate' | 'missing-link' | 'orphan' | 'contradiction';
  message: string;
  conceptIds: string[];
}

export interface RepairRunRow {
  id: string;
  status: RepairRunStatus;
  total: number;
  done: number;
  failed: number;
  started_at: number;
  finished_at: number | null;
  summary: string | null;
}

export interface RepairJobRow {
  id: string;
  run_id: string;
  kind: RepairJobKind;
  payload_json: string;
  status: RepairJobStatus;
  error: string | null;
  locked_by: string | null;
  attempts: number;
  updated_at: number;
}

export interface RepairSummary {
  merged: number;
  linked: number;
  orphanFixed: number;
  conflictQueued: number;
  deletedConceptIds: string[];
  touchedConceptIds: string[];
  aiFallbacks: number;
}

export interface RepairRunStatusResponse {
  id: string;
  status: RepairRunStatus;
  total: number;
  done: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
  summary: RepairSummary;
}

const WORKER_ID = `repair-${nanoid(6)}`;
const JOB_CAP = Math.max(1, Number(process.env.COMPOUND_REPAIR_JOB_CAP || 50));
const ORPHAN_CANDIDATE_LIMIT = 40;
const MAX_BODY_CHARS = 8000;

function emptySummary(): RepairSummary {
  return {
    merged: 0,
    linked: 0,
    orphanFixed: 0,
    conflictQueued: 0,
    deletedConceptIds: [],
    touchedConceptIds: [],
    aiFallbacks: 0,
  };
}

export function ensureRepairSchema(): void {
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS repair_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      total INTEGER NOT NULL,
      done  INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_repair_runs_status ON repair_runs(status, started_at DESC);

    CREATE TABLE IF NOT EXISTS repair_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      locked_by TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_repair_jobs_status ON repair_jobs(status, run_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_repair_jobs_run ON repair_jobs(run_id, status);
  `);
}

function normalizeFindings(findings: RepairFindingInput[]): RepairFindingInput[] {
  const seen = new Set<string>();
  const out: RepairFindingInput[] = [];
  for (const f of findings || []) {
    if (!f || !Array.isArray(f.conceptIds)) continue;
    const ids = Array.from(new Set(f.conceptIds.filter(Boolean)));
    if (ids.length === 0) continue;
    if (f.type === 'duplicate' || f.type === 'missing-link' || f.type === 'contradiction') {
      if (ids.length < 2) continue;
    }
    const key = `${f.type}|${[...ids].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...f, conceptIds: ids });
  }
  return out;
}

function kindForFinding(type: RepairFindingInput['type']): RepairJobKind | null {
  switch (type) {
    case 'duplicate':
      return 'merge';
    case 'missing-link':
      return 'link';
    case 'orphan':
      return 'orphan';
    case 'contradiction':
      return 'conflict';
    default:
      return null;
  }
}

export function countFixableFindings(findings: RepairFindingInput[]): number {
  return normalizeFindings(findings).filter((f) => kindForFinding(f.type)).length;
}

export interface CreateRepairRunResult {
  runId: string;
  total: number;
  dropped: number;
}

export function createRepairRun(findings: RepairFindingInput[]): CreateRepairRunResult {
  ensureRepairSchema();
  const normalized = normalizeFindings(findings).filter((f) => kindForFinding(f.type));
  const dropped = Math.max(0, normalized.length - JOB_CAP);
  const picked = normalized.slice(0, JOB_CAP);

  const runId = `rp-${nanoid(10)}`;
  const ts = now();
  const db = getServerDb();
  const insertRun = db.prepare(
    `INSERT INTO repair_runs (id, status, total, done, failed, started_at, summary)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
  );
  const insertJob = db.prepare(
    `INSERT INTO repair_jobs (id, run_id, kind, payload_json, status, attempts, updated_at)
     VALUES (?, ?, ?, ?, 'queued', 0, ?)`,
  );

  const txn = db.transaction(() => {
    insertRun.run(runId, 'running', picked.length, ts, JSON.stringify(emptySummary()));
    for (const finding of picked) {
      const kind = kindForFinding(finding.type)!;
      const payload = {
        conceptIds: finding.conceptIds,
        message: finding.message || '',
      };
      insertJob.run(`rj-${nanoid(10)}`, runId, kind, JSON.stringify(payload), ts);
    }
  });
  txn();

  return { runId, total: picked.length, dropped };
}

export function getRepairRunStatus(runId: string): RepairRunStatusResponse | null {
  ensureRepairSchema();
  const row = getServerDb().prepare(`SELECT * FROM repair_runs WHERE id = ?`).get(runId) as
    | RepairRunRow
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    done: row.done,
    failed: row.failed,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: { ...emptySummary(), ...parseJson<Partial<RepairSummary>>(row.summary, {}) },
  };
}

function getRun(runId: string): RepairRunRow | null {
  return (
    (getServerDb().prepare(`SELECT * FROM repair_runs WHERE id = ?`).get(runId) as
      | RepairRunRow
      | undefined) ?? null
  );
}

function readSummary(runId: string): RepairSummary {
  const run = getRun(runId);
  if (!run) return emptySummary();
  return { ...emptySummary(), ...parseJson<Partial<RepairSummary>>(run.summary, {}) };
}

function writeSummary(runId: string, summary: RepairSummary): void {
  getServerDb()
    .prepare(`UPDATE repair_runs SET summary = ? WHERE id = ?`)
    .run(JSON.stringify(summary), runId);
}

function bumpCounter(runId: string, field: 'done' | 'failed'): void {
  getServerDb().prepare(`UPDATE repair_runs SET ${field} = ${field} + 1 WHERE id = ?`).run(runId);
}

function markJob(id: string, status: RepairJobStatus, patch: { error?: string | null } = {}): void {
  getServerDb()
    .prepare(
      `UPDATE repair_jobs SET status = ?, error = ?, locked_by = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(status, patch.error ?? null, now(), id);
}

function claimOneJob(runId: string, usedIds: Set<string>): RepairJobRow | null {
  ensureRepairSchema();
  const db = getServerDb();
  const rows = db
    .prepare(
      `SELECT * FROM repair_jobs WHERE run_id = ? AND status = 'queued' ORDER BY updated_at ASC`,
    )
    .all(runId) as RepairJobRow[];

  for (const row of rows) {
    const payload = parseJson<{ conceptIds: string[] }>(row.payload_json, { conceptIds: [] });
    if (payload.conceptIds.some((id) => usedIds.has(id))) continue;

    const res = db
      .prepare(
        `UPDATE repair_jobs
         SET status = 'running', attempts = attempts + 1, locked_by = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(WORKER_ID, now(), row.id);
    if (res.changes > 0) {
      payload.conceptIds.forEach((id) => usedIds.add(id));
      return { ...row, status: 'running', locked_by: WORKER_ID };
    }
  }
  return null;
}

function requireConcept(id: string): Concept {
  const concept = repo.getConcept(id);
  if (!concept) throw new Error(`concept not found: ${id}`);
  return concept;
}

function pickPrimary(a: Concept, b: Concept): { primary: Concept; secondary: Concept } {
  const score = (c: Concept) => c.body.length * 2 + c.sources.length * 200 + c.updatedAt / 1e9;
  return score(a) >= score(b) ? { primary: a, secondary: b } : { primary: b, secondary: a };
}

function mergeArrays<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...(a || []), ...(b || [])]));
}

function writeActivity(runId: string, summary: RepairSummary, status: RepairRunStatus): void {
  const touchedIds = Array.from(
    new Set([...summary.touchedConceptIds, ...summary.deletedConceptIds]),
  ).slice(0, 40);
  const activity: ActivityLog = {
    id: `a-${nanoid(8)}`,
    type: 'lint',
    title:
      status === 'done'
        ? `一键修复完成`
        : status === 'failed'
          ? `一键修复部分失败`
          : `一键修复已取消`,
    details:
      `合并 ${summary.merged} 个 · 建链 ${summary.linked} 对 · 孤岛补 ${summary.orphanFixed} · 冲突入审 ${summary.conflictQueued}` +
      (summary.aiFallbacks > 0 ? ` · AI 降级 ${summary.aiFallbacks}` : ''),
    status: status === 'done' ? 'success' : status === 'failed' ? 'error' : undefined,
    relatedConceptIds: touchedIds,
    at: now(),
  };
  repo.insertActivity(activity);
  // also tag the run summary with the activity id so frontend can render a link
  const merged: RepairSummary = { ...summary };
  (merged as RepairSummary & { activityId?: string }).activityId = activity.id;
  writeSummary(runId, merged);
}

function finalizeRun(runId: string): void {
  const run = getRun(runId);
  if (!run || run.status !== 'running') return;
  const status: RepairRunStatus = run.failed > 0 && run.done === 0 ? 'failed' : 'done';
  getServerDb()
    .prepare(`UPDATE repair_runs SET status = ?, finished_at = ? WHERE id = ?`)
    .run(status, now(), runId);
  const summary = readSummary(runId);
  writeActivity(runId, summary, status);
}

// ---------------- strategies ----------------------------------------

async function runLinkJob(runId: string, job: RepairJobRow): Promise<void> {
  const payload = parseJson<{ conceptIds: string[] }>(job.payload_json, { conceptIds: [] });
  const [aId, bId] = payload.conceptIds;
  if (!aId || !bId || aId === bId) throw new Error('link job requires two distinct concepts');
  const a = requireConcept(aId);
  const b = requireConcept(bId);
  const ts = now();
  if (!a.related.includes(bId)) {
    repo.upsertConcept({
      ...a,
      related: Array.from(new Set([...a.related, bId])),
      updatedAt: ts,
      version: a.version + 1,
    });
  }
  if (!b.related.includes(aId)) {
    repo.upsertConcept({
      ...b,
      related: Array.from(new Set([...b.related, aId])),
      updatedAt: ts,
      version: b.version + 1,
    });
  }
  const summary = readSummary(runId);
  summary.linked += 1;
  summary.touchedConceptIds = mergeArrays(summary.touchedConceptIds, [aId, bId]);
  writeSummary(runId, summary);
}

async function runMergeJob(runId: string, job: RepairJobRow): Promise<void> {
  const payload = parseJson<{ conceptIds: string[]; message?: string }>(job.payload_json, {
    conceptIds: [],
  });
  const [aId, bId] = payload.conceptIds;
  if (!aId || !bId || aId === bId) throw new Error('merge job requires two distinct concepts');
  const a = requireConcept(aId);
  const b = requireConcept(bId);
  const { primary, secondary } = pickPrimary(a, b);

  let mergedTitle = primary.title;
  let mergedSummary = primary.summary;
  let mergedBody = `${primary.body}\n\n---\n\n${secondary.body}`.trim();
  let aiFallback = false;

  try {
    const prompt = `# 概念 A\nid: ${primary.id}\ntitle: ${primary.title}\nsummary: ${primary.summary}\n\nbody:\n${primary.body.slice(0, MAX_BODY_CHARS)}\n\n---\n\n# 概念 B\nid: ${secondary.id}\ntitle: ${secondary.title}\nsummary: ${secondary.summary}\n\nbody:\n${secondary.body.slice(0, MAX_BODY_CHARS)}\n\n---\n\n请按 system prompt 的 JSON schema 输出合并后的概念页,只输出 JSON。`;
    const raw = await chat({
      messages: [
        { role: 'system', content: MERGE_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.3,
      maxTokens: 1500,
      task: 'repair_merge',
    });
    const parsed = parseJSON<{ title?: string; summary?: string; body?: string }>(raw);
    if (parsed.title && parsed.title.trim()) mergedTitle = parsed.title.trim().slice(0, 80);
    if (parsed.summary && parsed.summary.trim())
      mergedSummary = parsed.summary.trim().slice(0, 240);
    if (parsed.body && parsed.body.trim().length >= 10) mergedBody = parsed.body.trim();
  } catch (err) {
    aiFallback = true;
    console.warn(
      '[repair] merge LLM failed, falling back to mechanical merge:',
      err instanceof Error ? err.message : String(err),
    );
  }

  const ts = now();
  const mergedSources = mergeArrays(primary.sources, secondary.sources);
  const mergedRelated = mergeArrays(primary.related, secondary.related).filter(
    (id) => id !== primary.id && id !== secondary.id,
  );
  const mergedCategoryKeysSet = new Set<string>([
    ...(primary.categoryKeys || []),
    ...(secondary.categoryKeys || []),
  ]);
  const mergedCategoriesMap = new Map<string, { primary: string; secondary?: string }>();
  [...(primary.categories || []), ...(secondary.categories || [])].forEach((cat) => {
    const key = `${cat.primary}|${cat.secondary ?? ''}`;
    if (!mergedCategoriesMap.has(key)) mergedCategoriesMap.set(key, cat);
  });

  repo.upsertConcept({
    ...primary,
    title: mergedTitle,
    summary: mergedSummary,
    body: mergedBody,
    sources: mergedSources,
    related: mergedRelated,
    categories: Array.from(mergedCategoriesMap.values()),
    categoryKeys: Array.from(mergedCategoryKeysSet),
    updatedAt: ts,
    version: primary.version + 1,
  });

  // Rewrite all references from secondary → primary, then delete secondary.
  repo.replaceRelatedId(secondary.id, primary.id, ts);
  repo.deleteConcept(secondary.id);

  const summary = readSummary(runId);
  summary.merged += 1;
  if (aiFallback) summary.aiFallbacks += 1;
  summary.deletedConceptIds = mergeArrays(summary.deletedConceptIds, [secondary.id]);
  summary.touchedConceptIds = mergeArrays(summary.touchedConceptIds, [primary.id]);
  writeSummary(runId, summary);
}

async function runOrphanJob(runId: string, job: RepairJobRow): Promise<void> {
  const payload = parseJson<{ conceptIds: string[] }>(job.payload_json, { conceptIds: [] });
  const [targetId] = payload.conceptIds;
  if (!targetId) throw new Error('orphan job requires at least one concept id');
  const target = requireConcept(targetId);

  const candidates = repo
    .findConceptCandidates(`${target.title}\n${target.summary}`, ORPHAN_CANDIDATE_LIMIT)
    .filter((c) => c.id !== targetId);

  if (candidates.length === 0) {
    markJob(job.id, 'skipped', { error: 'no candidate concepts found' });
    const summary = readSummary(runId);
    writeSummary(runId, summary);
    return;
  }

  const prompt = `# 目标概念\nid: ${target.id}\ntitle: ${target.title}\nsummary: ${target.summary}\n\nbody:\n${target.body.slice(0, 2000)}\n\n# 候选列表\n${candidates
    .map((c) => `- [${c.id}] ${c.title} — ${c.summary}`)
    .join('\n')}\n\n请按 system prompt 的 JSON schema 挑 1-3 个最相关的 id,只输出 JSON。`;

  let relatedIds: string[] = [];
  try {
    const raw = await chat({
      messages: [
        { role: 'system', content: ORPHAN_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.2,
      maxTokens: 500,
      task: 'repair_orphan',
    });
    const parsed = parseJSON<{ relatedIds?: string[] }>(raw);
    const valid = new Set(candidates.map((c) => c.id));
    relatedIds = (parsed.relatedIds || [])
      .filter((id) => valid.has(id) && id !== targetId)
      .slice(0, 3);
  } catch (err) {
    console.warn('[repair] orphan LLM failed:', err instanceof Error ? err.message : String(err));
  }

  if (relatedIds.length === 0) {
    markJob(job.id, 'skipped', { error: 'LLM returned no viable candidates' });
    return;
  }

  const ts = now();
  const merged = Array.from(new Set([...target.related, ...relatedIds]));
  repo.upsertConcept({
    ...target,
    related: merged,
    updatedAt: ts,
    version: target.version + 1,
  });

  for (const rid of relatedIds) {
    const other = repo.getConcept(rid);
    if (!other || other.related.includes(targetId)) continue;
    repo.upsertConcept({
      ...other,
      related: Array.from(new Set([...other.related, targetId])),
      updatedAt: ts,
      version: other.version + 1,
    });
  }

  const summary = readSummary(runId);
  summary.orphanFixed += 1;
  summary.touchedConceptIds = mergeArrays(summary.touchedConceptIds, [targetId, ...relatedIds]);
  writeSummary(runId, summary);
}

async function runConflictJob(runId: string, job: RepairJobRow): Promise<void> {
  const payload = parseJson<{ conceptIds: string[]; message?: string }>(job.payload_json, {
    conceptIds: [],
  });
  const [aId, bId] = payload.conceptIds;
  if (!aId || !bId) throw new Error('conflict job requires two concepts');
  const a = requireConcept(aId);
  const b = requireConcept(bId);

  const prompt = `# Linter 检出的矛盾\n${payload.message || '(无说明)'}\n\n# 概念 A\nid: ${a.id}\ntitle: ${a.title}\nsummary: ${a.summary}\n\nbody:\n${a.body.slice(0, MAX_BODY_CHARS)}\n\n---\n\n# 概念 B\nid: ${b.id}\ntitle: ${b.title}\nsummary: ${b.summary}\n\nbody:\n${b.body.slice(0, MAX_BODY_CHARS)}\n\n请按 system prompt 的 JSON schema 给出裁决,只输出 JSON。`;

  let verdict = '系统未能生成自动裁决,请人工复核。';
  let reasoning = payload.message || '';
  try {
    const raw = await chat({
      messages: [
        { role: 'system', content: CONFLICT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      responseFormat: 'json_object',
      temperature: 0.3,
      maxTokens: 800,
      task: 'repair_conflict',
    });
    const parsed = parseJSON<{ verdict?: string; reasoning?: string }>(raw);
    if (parsed.verdict && parsed.verdict.trim()) verdict = parsed.verdict.trim();
    if (parsed.reasoning && parsed.reasoning.trim()) reasoning = parsed.reasoning.trim();
  } catch (err) {
    console.warn('[repair] conflict LLM failed:', err instanceof Error ? err.message : String(err));
  }

  const pair = `[${a.title}](concept:${a.id}) · [${b.title}](concept:${b.id})`;
  const block = `\n\n> ⚠ 待确认：${verdict}\n>\n> ${reasoning.replace(/\n/g, '\n> ')}\n>\n> 关联：${pair}`;
  const ts = now();
  repo.upsertConcept({
    ...a,
    body: `${a.body}${block}`.trim(),
    updatedAt: ts,
    version: a.version + 1,
  });
  repo.upsertConcept({
    ...b,
    body: `${b.body}${block}`.trim(),
    updatedAt: ts,
    version: b.version + 1,
  });

  createReviewItem({
    kind: 'conflict',
    title: `概念冲突：${a.title} ↔ ${b.title}`,
    targetType: 'concept',
    targetId: a.id,
    sourceId: null,
    confidence: 0.4,
    payload: {
      conceptIds: [a.id, b.id],
      verdict,
      reasoning,
      lintMessage: payload.message || '',
    },
  });

  const summary = readSummary(runId);
  summary.conflictQueued += 1;
  summary.touchedConceptIds = mergeArrays(summary.touchedConceptIds, [a.id, b.id]);
  writeSummary(runId, summary);
}

async function dispatchJob(runId: string, job: RepairJobRow): Promise<void> {
  try {
    if (job.kind === 'link') await runLinkJob(runId, job);
    else if (job.kind === 'merge') await runMergeJob(runId, job);
    else if (job.kind === 'orphan') await runOrphanJob(runId, job);
    else if (job.kind === 'conflict') await runConflictJob(runId, job);
    else {
      markJob(job.id, 'skipped', { error: `unknown kind: ${String(job.kind)}` });
      return;
    }
    // Some strategies (orphan) set their own status via markJob(skipped).
    const latest = getServerDb()
      .prepare(`SELECT status FROM repair_jobs WHERE id = ?`)
      .get(job.id) as { status: RepairJobStatus } | undefined;
    if (latest?.status === 'running') {
      markJob(job.id, 'done');
      bumpCounter(runId, 'done');
    } else if (latest?.status === 'skipped') {
      bumpCounter(runId, 'done');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markJob(job.id, 'failed', { error: message.slice(0, 500) });
    bumpCounter(runId, 'failed');
    console.warn('[repair] job failed:', message);
  }
}

async function runRepairLoop(runId: string): Promise<void> {
  ensureRepairSchema();
  const usedIds = new Set<string>();
  for (;;) {
    const job = claimOneJob(runId, usedIds);
    if (!job) break;
    await dispatchJob(runId, job);
    const payload = parseJson<{ conceptIds: string[] }>(job.payload_json, { conceptIds: [] });
    payload.conceptIds.forEach((id) => usedIds.delete(id));
    if (usedIds.size > 200) usedIds.clear(); // defensive reset
  }
  finalizeRun(runId);
}

/**
 * Kick off (or resume) the repair worker for a given run. Fire-and-forget;
 * the returned Promise resolves when the in-memory loop exits. Subsequent
 * calls while the loop is still running are ignored.
 */
export function startRepairWorker(runId: string): void {
  ensureRepairSchema();
  const g = globalThis as unknown as { __compoundRepairWorkers?: Map<string, Promise<void>> };
  if (!g.__compoundRepairWorkers) g.__compoundRepairWorkers = new Map();
  if (g.__compoundRepairWorkers.has(runId)) return;
  const task = runRepairLoop(runId)
    .catch((err) => {
      console.error('[repair] worker crashed:', err);
      const db = getServerDb();
      db.prepare(`UPDATE repair_runs SET status = 'failed', finished_at = ? WHERE id = ?`).run(
        now(),
        runId,
      );
    })
    .finally(() => {
      g.__compoundRepairWorkers?.delete(runId);
    });
  g.__compoundRepairWorkers.set(runId, task);
}

/** Drain any still-running repair runs after a server restart. */
export function resumePendingRepairRuns(): void {
  ensureRepairSchema();
  const rows = getServerDb()
    .prepare(`SELECT id FROM repair_runs WHERE status = 'running'`)
    .all() as Array<{ id: string }>;
  for (const row of rows) startRepairWorker(row.id);
}
