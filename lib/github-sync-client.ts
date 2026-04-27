/**
 * 客户端 GitHub 同步编排
 * - 调用 `/api/sync/github/list` 列出仓库所有 .md
 * - 对比 IndexedDB 里已存的 externalKey，算出 new / updated / unchanged
 * - 串行拉取变更文件内容，调 `ingestSource` 喂给大模型
 * - 执行 update 时先删旧 Source 再 ingest 新内容（概念不会重建，会在已有概念上叠加）
 */
import { getDb } from './db';
import { ingestSource } from './api-client';
import { externalKeyPath } from './github-sync-shared';
import { getAdminAuthHeaders } from './admin-auth-client';
import { withRequestId } from './trace-client';

export type SyncFileStatus =
  | 'unchanged' // 本地 externalKey 完全匹配（path@sha 一致），跳过
  | 'pending' // 待同步（new/updated）
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'; // 用户取消勾选

export type SyncAction = 'create' | 'update';

export interface SyncFile {
  /** GitHub 文件路径 */
  path: string;
  /** GitHub blob sha（内容 hash） */
  sha: string;
  /** 文件字节数 */
  size: number;
  /** 本次的 externalKey（按最新 sha 算出） */
  externalKey: string;
  /** 该文件是新的还是已存在但变更了 */
  action: SyncAction;
  /** 已存在 Source 的 id（仅 update 时有值） */
  existingSourceId?: string;
  status: SyncFileStatus;
  selected: boolean;
  error?: string;
  newConcepts?: number;
  updatedConcepts?: number;
}

export interface ListedFile {
  path: string;
  sha: string;
  size: number;
  externalKey: string;
}

export interface ListResponse {
  repo: string;
  branch: string;
  count: number;
  files: ListedFile[];
}

/**
 * 调服务端 list 接口，返回仓库所有 md 文件清单。
 */
export async function fetchRemoteFileList(): Promise<ListResponse> {
  const res = await fetch('/api/sync/github/list', { headers: withRequestId(getAdminAuthHeaders()) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `同步失败 (${res.status}): ${text.slice(0, 300) || '请检查 GitHub 环境变量配置'}`,
    );
  }
  return (await res.json()) as ListResponse;
}

/**
 * 拉取单个文件的 raw 内容。
 */
export async function fetchRemoteFileContent(path: string): Promise<{
  path: string;
  sha: string;
  content: string;
  externalKey: string;
}> {
  const res = await fetch('/api/sync/github/content', {
    method: 'POST',
    headers: withRequestId({ 'Content-Type': 'application/json', ...getAdminAuthHeaders() }),
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * 把远端文件清单与本地 Sources 做 diff，产出同步计划。
 */
export async function buildSyncPlan(remote: ListedFile[]): Promise<SyncFile[]> {
  const db = getDb();
  const sources = await db.sources.toArray();

  // 建立 path → Source 的映射（仅统计 github: 开头的 externalKey）
  const localByPath = new Map<string, { id: string; externalKey: string }>();
  for (const s of sources) {
    if (!s.externalKey || !s.externalKey.startsWith('github:')) continue;
    const path = externalKeyPath(s.externalKey);
    if (!path) continue;
    localByPath.set(path, { id: s.id, externalKey: s.externalKey });
  }

  const plan: SyncFile[] = [];
  for (const f of remote) {
    const local = localByPath.get(f.path);
    if (!local) {
      plan.push({
        ...f,
        action: 'create',
        status: 'pending',
        selected: true,
      });
    } else if (local.externalKey === f.externalKey) {
      plan.push({
        ...f,
        action: 'update',
        existingSourceId: local.id,
        status: 'unchanged',
        selected: false,
      });
    } else {
      plan.push({
        ...f,
        action: 'update',
        existingSourceId: local.id,
        status: 'pending',
        selected: true,
      });
    }
  }
  // 稳定排序：先列待同步的，再列已同步的
  plan.sort((a, b) => {
    const order = (f: SyncFile) => (f.status === 'pending' ? 0 : 1);
    if (order(a) !== order(b)) return order(a) - order(b);
    return a.path.localeCompare(b.path);
  });
  return plan;
}

export interface RunSyncOptions {
  plan: SyncFile[];
  onUpdate: (file: SyncFile, newIds?: string[]) => void;
  shouldStop: () => boolean;
}

/**
 * 串行执行同步队列。对每个待同步文件：
 * 1. 标 running → onUpdate
 * 2. 拉原文
 * 3. 若是 update，先删掉旧 Source（保留 Concept/Activity 历史）
 * 4. 调 ingestSource，externalKey 写入新 Source
 * 5. 成功/失败回调
 */
export async function runGithubSyncQueue({
  plan,
  onUpdate,
  shouldStop,
}: RunSyncOptions): Promise<void> {
  const db = getDb();

  for (const f of plan) {
    if (shouldStop()) return;
    if (!f.selected || f.status !== 'pending') continue;

    onUpdate({ ...f, status: 'running' });

    try {
      const remote = await fetchRemoteFileContent(f.path);

      const result = await ingestSource({
        title: deriveTitle(remote.path, remote.content),
        type: 'file',
        url: undefined, // 不暴露 raw GitHub URL
        rawContent: remote.content,
        externalKey: remote.externalKey,
      });

      // 更新场景：ingest 成功拿到新 sourceId 后再删旧 Source，避免中途中断导致数据丢失
      if (f.action === 'update' && f.existingSourceId) {
        await db.sources.delete(f.existingSourceId);
      }

      onUpdate(
        {
          ...f,
          sha: remote.sha,
          externalKey: remote.externalKey,
          status: 'success',
          newConcepts: result.newConceptIds.length,
          updatedConcepts: result.updatedConceptIds.length,
        },
        result.newConceptIds,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onUpdate({ ...f, status: 'failed', error: msg.slice(0, 200) });
    }
  }
}

/**
 * 从 Markdown 原文提取标题：frontmatter.title > 首个 ATX 标题 > 文件名
 */
function deriveTitle(path: string, content: string): string {
  // frontmatter title
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
  // First H1 heading
  const h1 = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  // Fallback: filename without extension
  const base = path.split('/').pop() || path;
  return base.replace(/\.md$/i, '');
}
