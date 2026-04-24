/**
 * GitHub sync runner v2.
 *
 * Sync is split into two phases:
 * 1) GitHub scan/diff/download, which is fast and deterministic.
 * 2) Async analysis worker, which performs LLM ingest, chunk/FTS, embeddings,
 *    summaries, review queue generation, and retry/backoff.
 *
 * The legacy `sync_jobs` table is still updated so the existing modal keeps
 * working while `/sync` exposes the richer run/item/job dashboard.
 */
import { nanoid } from 'nanoid';
import { listMarkdownFiles, fetchMarkdownContent, getGithubConfig } from './github-sync';
import { externalKeyPath } from './github-sync-shared';
import { repo, type SyncJobRow } from './server-db';
import { wikiRepo } from './wiki-db';
import { syncObs, type SyncChangeType } from './sync-observability';
import { queueGithubIngestJob, startAnalysisWorker, maybeFinishRun, cancelAnalysisJobs } from './analysis-worker';

const MAX_LOG_ENTRIES = 50;
const STALE_JOB_MAX_AGE_MS = Number(process.env.COMPOUND_SYNC_STALE_MS || 10 * 60 * 1000);
const HARD_DELETE_MODE = process.env.COMPOUND_GITHUB_DELETE_MODE === 'hard';

interface LogEntry {
  at: number;
  path: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
}

interface LocalGithubSource {
  id: string;
  externalKey: string;
  path: string;
  sha: string | null;
}

interface PlanItem {
  itemId: string;
  path: string;
  sha: string | null;
  oldSha?: string | null;
  externalKey: string | null;
  action: SyncChangeType;
  existingSourceId?: string;
}

export interface StartGithubSyncOptions {
  triggerType?: 'manual' | 'webhook' | 'schedule';
  force?: boolean;
}

function readLog(row: SyncJobRow | null): LogEntry[] {
  if (!row?.log) return [];
  try {
    const v = JSON.parse(row.log);
    return Array.isArray(v) ? (v as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function appendLog(row: SyncJobRow, entry: LogEntry): string {
  const prev = readLog(row);
  prev.push(entry);
  while (prev.length > MAX_LOG_ENTRIES) prev.shift();
  return JSON.stringify(prev);
}

function appendLogByJobId(jobId: string, entry: LogEntry, patch: Partial<SyncJobRow> = {}): void {
  const row = repo.getSyncJob(jobId);
  if (!row) return;
  repo.updateSyncJob(jobId, { ...patch, log: appendLog(row, entry) });
}

function externalKeySha(key: string | null | undefined): string | null {
  if (!key) return null;
  const match = key.match(/@([0-9a-f]{7,64})$/i);
  return match?.[1] ?? null;
}

function deriveTitle(filePath: string, content: string): string {
  const fm = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (fm) {
    const line = fm[1].split(/\r?\n/).find((l) => /^title\s*:/i.test(l));
    if (line) {
      const v = line.replace(/^title\s*:/i, '').trim().replace(/^["'](.*)["']$/, '$1').trim();
      if (v) return v;
    }
  }
  const h1 = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  return (filePath.split('/').pop() || filePath).replace(/\.md$/i, '');
}

async function withRetry<T>(fn: () => Promise<T>, opts: { retries: number; baseDelayMs: number; label: string; runId?: string; path?: string }): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= opts.retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      const permanent = /^Invalid API URL/i.test(message) || /\b(401|403|404)\b/.test(message);
      if (permanent || i === opts.retries) break;
      const delay = opts.baseDelayMs * 2 ** i + Math.floor(Math.random() * 250);
      syncObs.recordEvent({ runId: opts.runId, stage: 'download', path: opts.path, level: 'warn', message: `${opts.label} 失败，${delay}ms 后重试` });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last;
}

function loadLocalGithubSources(): LocalGithubSource[] {
  return repo.listGithubExternalKeys()
    .map((row) => ({
      id: row.id,
      externalKey: row.externalKey,
      path: externalKeyPath(row.externalKey) || '',
      sha: externalKeySha(row.externalKey),
    }))
    .filter((row) => Boolean(row.path));
}


function maybeFinishLegacyJob(jobId: string): void {
  const row = repo.getSyncJob(jobId);
  if (!row || row.status !== 'running') return;
  if (row.total > 0 && row.done + row.failed >= row.total) {
    repo.updateSyncJob(jobId, {
      status: row.failed > 0 ? 'failed' : 'done',
      current: row.failed > 0 ? '部分文件失败，请到 /sync 查看详情' : null,
      error: row.failed > 0 ? '部分文件失败，请到 /sync 查看详情' : null,
      finished_at: Date.now(),
    });
  }
}

function bumpLegacy(jobId: string, field: 'done' | 'failed', current?: string): void {
  const row = repo.getSyncJob(jobId);
  if (!row) return;
  repo.updateSyncJob(jobId, {
    done: field === 'done' ? row.done + 1 : row.done,
    failed: field === 'failed' ? row.failed + 1 : row.failed,
    current: current ?? row.current,
  });
}

export function startGithubSync(options: StartGithubSyncOptions = {}): { jobId: string; existing?: boolean; runId?: string } {
  const recovered = repo.recoverStaleSyncJobs(STALE_JOB_MAX_AGE_MS);
  if (recovered > 0) console.log(`[github-sync-runner] recovered ${recovered} stale job(s)`);

  const active = repo.getActiveSyncJob();
  if (active) return { jobId: active.id, existing: true };

  const jobId = `job-${nanoid(10)}`;
  const now = Date.now();
  repo.insertSyncJob({
    id: jobId,
    kind: 'github',
    status: 'running',
    total: 0,
    done: 0,
    failed: 0,
    current: null,
    log: '[]',
    error: null,
    started_at: now,
    finished_at: null,
  });

  const promise = runGithubSyncLoop(jobId, options).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    repo.updateSyncJob(jobId, { status: 'failed', error: message, finished_at: Date.now() });
  });
  const g = globalThis as unknown as { __activeSyncPromises?: Set<Promise<void>> };
  g.__activeSyncPromises ??= new Set();
  g.__activeSyncPromises.add(promise);
  void promise.finally(() => g.__activeSyncPromises?.delete(promise));
  return { jobId };
}

async function runGithubSyncLoop(jobId: string, options: StartGithubSyncOptions): Promise<void> {
  let cfg: ReturnType<typeof getGithubConfig>;
  let runId = `sr-${nanoid(10)}`;
  try {
    cfg = getGithubConfig();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repo.updateSyncJob(jobId, { status: 'failed', error: `GitHub 配置错误：${message}`, finished_at: Date.now() });
    return;
  }
  const repoSlug = `${cfg.owner}/${cfg.repo}`;
  syncObs.startRun({ id: runId, kind: 'github', triggerType: options.triggerType || 'manual', repo: repoSlug, branch: cfg.branch });
  syncObs.recordEvent({ runId, stage: 'scan', message: `开始扫描 ${repoSlug}@${cfg.branch}` });
  appendLogByJobId(jobId, { at: Date.now(), path: '仓库扫描', status: 'success', message: '开始扫描远端 Markdown 文件' }, { current: '扫描 GitHub 仓库…' });

  let remote: Awaited<ReturnType<typeof listMarkdownFiles>>;
  try {
    remote = await listMarkdownFiles(cfg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    syncObs.finishRun(runId, 'failed', message);
    repo.updateSyncJob(jobId, { status: 'failed', error: `GitHub 列表失败：${message}`, finished_at: Date.now() });
    return;
  }

  const localByPath = new Map(loadLocalGithubSources().map((row) => [row.path, row]));
  const remoteByPath = new Map(remote.map((row) => [row.path, row]));
  const plan: PlanItem[] = [];

  for (const f of remote) {
    const local = localByPath.get(f.path);
    if (!local) {
      plan.push({ itemId: `sri-${nanoid(10)}`, path: f.path, sha: f.sha, externalKey: f.externalKey, action: 'create' });
    } else if (options.force || local.externalKey !== f.externalKey) {
      plan.push({ itemId: `sri-${nanoid(10)}`, path: f.path, sha: f.sha, oldSha: local.sha, externalKey: f.externalKey, action: 'update', existingSourceId: local.id });
    } else {
      syncObs.markSourceFileActive({ repo: repoSlug, branch: cfg.branch, path: f.path, sourceId: local.id, externalKey: f.externalKey, blobSha: f.sha, runId });
    }
  }

  for (const local of localByPath.values()) {
    if (!remoteByPath.has(local.path)) {
      plan.push({ itemId: `sri-${nanoid(10)}`, path: local.path, sha: null, oldSha: local.sha, externalKey: local.externalKey, action: 'delete', existingSourceId: local.id });
    }
  }

  const created = plan.filter((item) => item.action === 'create').length;
  const updated = plan.filter((item) => item.action === 'update').length;
  const deleted = plan.filter((item) => item.action === 'delete').length;
  syncObs.updateRun(runId, {
    stage: 'diff',
    total_files: remote.length,
    changed_files: plan.length,
    created_files: created,
    updated_files: updated,
    deleted_files: deleted,
    skipped_files: Math.max(0, remote.length - created - updated),
    current: `待处理 ${plan.length} 个文件`,
  });
  repo.updateSyncJob(jobId, { total: plan.length, current: `待处理 ${plan.length} 个文件` });
  appendLogByJobId(jobId, { at: Date.now(), path: '同步计划', status: 'success', message: `新增 ${created} · 更新 ${updated} · 删除 ${deleted}` });
  syncObs.recordEvent({ runId, stage: 'diff', level: 'success', message: `计划完成：新增 ${created}，更新 ${updated}，删除 ${deleted}` });

  if (plan.length === 0) {
    syncObs.finishRun(runId, 'done');
    repo.updateSyncJob(jobId, { status: 'done', current: '没有检测到需要同步的文件', finished_at: Date.now() });
    return;
  }

  for (const [index, item] of plan.entries()) {
    const legacy = repo.getSyncJob(jobId);
    if (!legacy || legacy.status !== 'running') {
      syncObs.finishRun(runId, 'cancelled', 'legacy job stopped');
      cancelAnalysisJobs({ runId });
      return;
    }

    const itemId = syncObs.upsertRunItem({
      id: item.itemId,
      runId,
      path: item.path,
      oldSha: item.oldSha ?? null,
      newSha: item.sha ?? null,
      externalKey: item.externalKey ?? null,
      sourceId: item.existingSourceId ?? null,
      changeType: item.action,
      status: 'queued',
      stage: item.action === 'delete' ? 'delete' : 'download',
    });

    repo.updateSyncJob(jobId, { current: `[${index + 1}/${plan.length}] ${item.path}` });
    syncObs.updateRun(runId, { stage: item.action === 'delete' ? 'delete' : 'download', current: item.path });

    if (item.action === 'delete') {
      try {
        syncObs.markSourceFileDeleted({ repo: repoSlug, branch: cfg.branch, path: item.path, runId });
        if (HARD_DELETE_MODE && item.existingSourceId) {
          wikiRepo.deleteSourceArtifacts(item.existingSourceId);
          repo.deleteSource(item.existingSourceId);
        }
        syncObs.updateRunItem(itemId, { status: 'succeeded', stage: 'complete', finished_at: Date.now() });
        bumpLegacy(jobId, 'done', `已处理删除：${item.path}`);
        syncObs.recordEvent({ runId, itemId, stage: 'delete', path: item.path, level: 'success', message: HARD_DELETE_MODE ? '已硬删除本地资料' : '已标记为远端删除' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        syncObs.updateRunItem(itemId, { status: 'failed', stage: 'delete', error: message, finished_at: Date.now() });
        bumpLegacy(jobId, 'failed', `删除失败：${item.path}`);
      }
      maybeFinishRun(runId);
      maybeFinishLegacyJob(jobId);
      continue;
    }

    try {
      const remoteFile = await withRetry(() => fetchMarkdownContent(item.path, cfg, item.sha || undefined), {
        retries: 2,
        baseDelayMs: 600,
        label: `fetch ${item.path}`,
        runId,
        path: item.path,
      });
      queueGithubIngestJob({
        runId,
        itemId,
        legacyJobId: jobId,
        repoSlug,
        branch: cfg.branch,
        path: remoteFile.path,
        sha: remoteFile.sha,
        externalKey: remoteFile.externalKey,
        title: deriveTitle(remoteFile.path, remoteFile.content),
        rawContent: remoteFile.content,
        replaceSourceId: item.existingSourceId ?? null,
      });
      syncObs.updateRunItem(itemId, { status: 'queued', stage: 'ingest', error: null });
      syncObs.recordEvent({ runId, itemId, stage: 'ingest', path: item.path, message: '已下载并加入分析队列' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      syncObs.updateRunItem(itemId, { status: 'failed', stage: 'download', error: message, finished_at: Date.now() });
      bumpLegacy(jobId, 'failed', `下载失败：${item.path}`);
      syncObs.recordEvent({ runId, itemId, stage: 'download', path: item.path, level: 'error', message: message.slice(0, 200) });
      maybeFinishRun(runId);
      maybeFinishLegacyJob(jobId);
    }
  }

  maybeFinishLegacyJob(jobId);
  repo.updateSyncJob(jobId, { current: 'GitHub 下载完成，后台分析继续运行…' });
  syncObs.updateRun(runId, { stage: 'llm', current: 'GitHub 下载完成，后台分析继续运行…' });
  startAnalysisWorker('github-sync');
  maybeFinishRun(runId);
}

export function cancelGithubSync(): { cancelledRuns: number; cancelledJobs: number } {
  const active = repo.getActiveSyncJob();
  if (active) {
    repo.updateSyncJob(active.id, {
      status: 'failed',
      error: '用户取消同步任务',
      current: '已取消',
      finished_at: Date.now(),
    });
  }
  const dashboard = syncObs.getDashboard();
  const runId = dashboard.activeRun?.id ?? null;
  if (runId) syncObs.finishRun(runId, 'cancelled', '用户取消同步任务');
  const cancelledJobs = cancelAnalysisJobs({ runId });
  return { cancelledRuns: runId ? 1 : 0, cancelledJobs };
}

export interface SyncJobStatus {
  id: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  done: number;
  failed: number;
  current: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  log: LogEntry[];
}

export function getSyncJobStatus(jobId: string): SyncJobStatus | null {
  const row = repo.getSyncJob(jobId);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    total: row.total,
    done: row.done,
    failed: row.failed,
    current: row.current,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    log: readLog(row),
  };
}
