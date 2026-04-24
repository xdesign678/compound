/**
 * Server-side GitHub sync runner.
 *
 * Responsibilities:
 *   1. List all Markdown files on the configured GitHub branch.
 *   2. Diff against SQLite sources (by externalKey path).
 *   3. For each new/changed file, fetch raw content and call ingest-core + persist.
 *   4. Continuously update the corresponding `sync_jobs` row so the client can poll.
 *
 * Runs in the background after `/api/sync/github/run` returns. Only one job at a
 * time is supported (guarded by `repo.getActiveSyncJob()`).
 */

import { nanoid } from 'nanoid';
import {
  listMarkdownFiles,
  fetchMarkdownContent,
  getGithubConfig,
} from './github-sync';
import { externalKeyPath } from './github-sync-shared';
import { repo, type SyncJobRow } from './server-db';
import { ingestSourceToServerDb } from './server-ingest';

const MAX_LOG_ENTRIES = 50;

interface LogEntry {
  at: number;
  path: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
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
  repo.updateSyncJob(jobId, {
    ...patch,
    log: appendLog(row, entry),
  });
}

/**
 * Exponential backoff with jitter. Used for transient LLM/network failures
 * during per-file ingest. Rate-limit responses and 5xx are common and worth
 * retrying once or twice before giving up on the file.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries: number; baseDelayMs: number; label: string }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      // Permanent-looking errors — skip retry
      if (/^Invalid API URL/i.test(message) || /401|403|404/.test(message)) break;
      if (attempt === opts.retries) break;
      const delay = opts.baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
      console.warn(`[github-sync-runner] ${opts.label}: attempt ${attempt + 1} failed (${message.slice(0, 120)}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

function deriveTitle(filePath: string, content: string): string {
  const fm = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
  if (fm) {
    const line = fm[1].split(/\r?\n/).find((l) => /^title\s*:/i.test(l));
    if (line) {
      const v = line
        .replace(/^title\s*:/i, '')
        .trim()
        .replace(/^["'](.*)["']$/, '$1')
        .trim();
      if (v) return v;
    }
  }
  const h1 = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  const base = filePath.split('/').pop() || filePath;
  return base.replace(/\.md$/i, '');
}

/**
 * Create a sync_jobs row and kick off the background loop (non-blocking).
 * Returns the job id immediately so the client can start polling.
 */
export function startGithubSync(): { jobId: string; existing?: boolean } {
  // Recover zombie jobs from crashed/restarted previous runs.
  const recovered = repo.recoverStaleSyncJobs(10 * 60 * 1000);
  if (recovered > 0) {
    console.log(`[github-sync-runner] recovered ${recovered} stale running job(s)`);
  }

  // Only one active job at a time.
  const active = repo.getActiveSyncJob();
  if (active) {
    console.log(`[github-sync-runner] reusing active job ${active.id}`);
    return { jobId: active.id, existing: true };
  }

  const jobId = 'job-' + nanoid(10);
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
  console.log(`[github-sync-runner] created job ${jobId}`);

  // Fire and forget — the loop handles its own errors and final status.
  // Hold a reference on globalThis so the Promise isn't GC'd prematurely.
  const promise = runGithubSyncLoop(jobId).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[github-sync-runner] unexpected:', message);
    repo.updateSyncJob(jobId, {
      status: 'failed',
      error: message,
      finished_at: Date.now(),
    });
  });

  // Attach to a global set so Node doesn't treat it as unreferenced.
  const g = globalThis as unknown as { __activeSyncPromises?: Set<Promise<void>> };
  g.__activeSyncPromises ??= new Set();
  g.__activeSyncPromises.add(promise);
  void promise.finally(() => g.__activeSyncPromises?.delete(promise));

  return { jobId };
}

async function runGithubSyncLoop(jobId: string): Promise<void> {
  console.log(`[github-sync-runner] ${jobId}: loop started`);

  let cfg;
  try {
    cfg = getGithubConfig();
    console.log(`[github-sync-runner] ${jobId}: github config ok, repo=${cfg.owner}/${cfg.repo} branch=${cfg.branch}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[github-sync-runner] ${jobId}: github config error:`, message);
    repo.updateSyncJob(jobId, {
      status: 'failed',
      error: `GitHub 配置错误：${message}`,
      finished_at: Date.now(),
    });
    return;
  }

  // 1. List remote files
  repo.updateSyncJob(jobId, { current: '扫描 GitHub 仓库…' });
  appendLogByJobId(jobId, {
    at: Date.now(),
    path: '仓库扫描',
    status: 'success',
    message: '开始扫描远端 Markdown 文件',
  });

  let remote: Awaited<ReturnType<typeof listMarkdownFiles>>;
  try {
    remote = await listMarkdownFiles(cfg);
    console.log(`[github-sync-runner] ${jobId}: listed ${remote.length} markdown files from GitHub`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[github-sync-runner] ${jobId}: list failed:`, message);
    repo.updateSyncJob(jobId, {
      status: 'failed',
      error: `GitHub 列表失败：${message}`,
      finished_at: Date.now(),
    });
    return;
  }

  // 2. Build local-by-path map from SQLite
  repo.updateSyncJob(jobId, { current: `已扫描 ${remote.length} 个文件，正在比对本地差异…` });
  const localByPath = new Map<string, { id: string; externalKey: string }>();
  for (const row of repo.listGithubExternalKeys()) {
    const p = externalKeyPath(row.externalKey);
    if (p) localByPath.set(p, { id: row.id, externalKey: row.externalKey });
  }

  // 3. Decide which files need syncing
  type PlanItem = {
    path: string;
    sha: string;
    externalKey: string;
    action: 'create' | 'update';
    existingSourceId?: string;
  };
  const plan: PlanItem[] = [];
  for (const f of remote) {
    const local = localByPath.get(f.path);
    if (!local) {
      plan.push({
        path: f.path,
        sha: f.sha,
        externalKey: f.externalKey,
        action: 'create',
      });
    } else if (local.externalKey !== f.externalKey) {
      plan.push({
        path: f.path,
        sha: f.sha,
        externalKey: f.externalKey,
        action: 'update',
        existingSourceId: local.id,
      });
    }
  }

  repo.updateSyncJob(jobId, { total: plan.length });
  appendLogByJobId(jobId, {
    at: Date.now(),
    path: '同步计划',
    status: 'success',
    message: `待处理 ${plan.length} 个文件`,
  });
  console.log(`[github-sync-runner] ${jobId}: plan ready, ${plan.length} file(s) to process`);

  // 4. Serial execution with progress updates
  for (const [index, item] of plan.entries()) {
    // Check if job was cancelled externally (status flipped to 'failed' etc.)
    const current = repo.getSyncJob(jobId);
    if (!current || current.status !== 'running') return;

    repo.updateSyncJob(jobId, { current: `[${index + 1}/${plan.length}] ${item.path}` });

    try {
      const remoteFile = await withRetry(
        () => fetchMarkdownContent(item.path, cfg, item.sha),
        { retries: 2, baseDelayMs: 600, label: `fetch ${item.path}` }
      );

      // `ingestSourceToServerDb` handles the update-case dedup via externalKey.
      const result = await withRetry(
        () =>
          ingestSourceToServerDb({
            title: deriveTitle(remoteFile.path, remoteFile.content),
            type: 'file',
            rawContent: remoteFile.content,
            externalKey: remoteFile.externalKey,
            replaceSourceId: item.existingSourceId,
          }),
        { retries: 1, baseDelayMs: 1500, label: `ingest ${item.path}` }
      );

      const row = repo.getSyncJob(jobId);
      if (!row) return;
      repo.updateSyncJob(jobId, {
        done: row.done + 1,
        log: appendLog(row, {
          at: Date.now(),
          path: item.path,
          status: 'success',
          message: result.compiler
            ? `新增概念 ${result.newConceptIds.length} · 更新 ${result.updatedConceptIds.length} · 分块 ${result.compiler.chunks} · 证据 ${result.compiler.evidence}`
            : `新增概念 ${result.newConceptIds.length} · 更新 ${result.updatedConceptIds.length}`,
        }),
      });
      console.log(
        `[github-sync-runner] ${jobId}: ✓ ${item.path} (done=${row.done + 1}/${row.total})`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = repo.getSyncJob(jobId);
      if (!row) return;
      repo.updateSyncJob(jobId, {
        failed: row.failed + 1,
        log: appendLog(row, {
          at: Date.now(),
          path: item.path,
          status: 'failed',
          message: message.slice(0, 200),
        }),
      });
      console.warn(`[github-sync-runner] ${jobId}: ✗ ${item.path} — ${message.slice(0, 200)}`);
    }
  }

  // 5. Finalize
  const final = repo.getSyncJob(jobId);
  if (final) {
    repo.updateSyncJob(jobId, {
      status: 'done',
      current: final.total === 0 ? '没有检测到需要同步的文件' : null,
      finished_at: Date.now(),
    });
    console.log(
      `[github-sync-runner] ${jobId}: ✅ done — total=${final.total} success=${final.done} failed=${final.failed}`
    );
  }
}

/**
 * Shape returned to the client when polling status.
 */
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
