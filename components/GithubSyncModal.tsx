'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';
import { pullSnapshotFromCloud } from '@/lib/cloud-sync';

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

interface LogEntry {
  at: number;
  path: string;
  status: 'success' | 'failed' | 'skipped';
  message?: string;
}

interface JobStatus {
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

const POLL_INTERVAL_MS = 1500;

export function GithubSyncModal() {
  const open = useAppStore((s) => s.githubSyncOpen);
  const close = useAppStore((s) => s.closeGithubSync);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulledAfterDoneRef = useRef(false);

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
      setJob(null);
      pulledAfterDoneRef.current = false;
    } else {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [open]);

  const pollOnce = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/sync/status?jobId=${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`状态查询失败 (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as JobStatus;
      setJob(data);
      if (data.status === 'running') {
        setPhase('running');
        pollTimerRef.current = setTimeout(() => void pollOnce(jobId), POLL_INTERVAL_MS);
      } else if (data.status === 'done') {
        setPhase('done');
        // 任务成功后，自动把服务端新数据拉回本地 IndexedDB。
        if (!pulledAfterDoneRef.current) {
          pulledAfterDoneRef.current = true;
          setPulling(true);
          pullSnapshotFromCloud()
            .catch((e) => console.warn('[cloud-sync] post-sync pull failed:', e))
            .finally(() => setPulling(false));
        }
      } else {
        setPhase('failed');
        setError(data.error || '同步失败');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase('failed');
    }
  }, []);

  const start = useCallback(async () => {
    setPhase('starting');
    setError(null);
    try {
      const res = await fetch('/api/sync/github/run', { method: 'POST' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`启动失败 (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as { jobId: string; existing?: boolean };
      setPhase('running');
      void pollOnce(data.jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setPhase('failed');
    }
  }, [pollOnce]);

  if (!open) return null;

  const canClose = phase !== 'starting';
  const progressPct =
    job && job.total > 0 ? Math.round(((job.done + job.failed) / job.total) * 100) : 0;

  return (
    <div className="modal-overlay visible" onClick={canClose ? close : undefined}>
      <div className="modal gh-sync-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <header className="gh-sync-header">
          <div className="gh-sync-title">
            <Icon.Github />
            <h2>从 GitHub 同步</h2>
          </div>
          <button
            className="icon-btn gh-sync-close"
            onClick={close}
            disabled={!canClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        {phase === 'idle' && <IdleView onStart={start} error={error} />}

        {phase === 'starting' && (
          <div className="gh-sync-idle">
            <p className="gh-sync-lede">🚀 正在启动服务端同步任务…</p>
          </div>
        )}

        {(phase === 'running' || phase === 'done' || phase === 'failed') && job && (
          <>
            <div className="gh-sync-meta">
              <span className="gh-sync-repo">
                {phase === 'running' ? '🔄 服务端同步中' : phase === 'done' ? '✅ 同步完成' : '⚠️ 同步失败'}
              </span>
              <span className="gh-sync-stats">
                共 {job.total} 个文件 · 成功 <strong>{job.done}</strong> · 失败{' '}
                <strong>{job.failed}</strong>
              </span>
            </div>

            {job.total > 0 && (
              <div className="gh-sync-progress-bar" aria-label="同步进度">
                <div className="gh-sync-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            )}

            {phase === 'running' && job.current && (
              <p className="gh-sync-current">
                正在处理：<code>{job.current}</code>
              </p>
            )}

            {error && (
              <div className="gh-sync-error">
                <strong>失败原因：</strong>
                <pre>{error}</pre>
                <p className="gh-sync-hint">
                  常见原因：<code>GITHUB_TOKEN</code>、<code>GITHUB_REPO</code> 未配置，或
                  <code>LLM_API_KEY</code> 在 Zeabur 环境变量里缺失。
                </p>
              </div>
            )}

            <div className="gh-sync-list gh-sync-log">
              {job.log.length === 0 ? (
                <p className="gh-sync-lede">暂无日志，首次同步可能需要几秒扫描仓库…</p>
              ) : (
                job.log
                  .slice()
                  .reverse()
                  .map((entry, i) => (
                    <div
                      key={`${entry.path}-${entry.at}-${i}`}
                      className={`gh-sync-row ${entry.status === 'success' ? 'success' : 'failed'}`}
                    >
                      <span className="gh-sync-path" title={entry.path}>
                        {entry.path}
                      </span>
                      <span
                        className={`gh-sync-status ${
                          entry.status === 'success' ? 'success' : 'failed'
                        }`}
                      >
                        {entry.status === 'success' ? '✓' : '×'}{' '}
                        {entry.message ?? ''}
                      </span>
                    </div>
                  ))
              )}
            </div>

            <footer className="gh-sync-footer">
              {phase === 'running' && (
                <span className="gh-sync-progress-text">
                  进行中…{progressPct}% （关闭本窗口也不会中断，服务端会继续跑）
                </span>
              )}
              {phase === 'done' && (
                <>
                  <span className="gh-sync-progress-text">
                    ✅ 完成 {pulling ? '· 正在拉取最新数据…' : '· 数据已同步到本地'}
                  </span>
                  <button className="btn-primary" onClick={close}>
                    关闭
                  </button>
                </>
              )}
              {phase === 'failed' && (
                <>
                  <span className="gh-sync-progress-text">请检查失败原因后重试。</span>
                  <button className="btn-ghost" onClick={() => setPhase('idle')}>
                    重试
                  </button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function IdleView({ onStart, error }: { onStart: () => void; error: string | null }) {
  return (
    <div className="gh-sync-idle">
      <p className="gh-sync-lede">
        点下面按钮启动<strong>服务端</strong>同步。Zeabur 后端会自动对比本地 SQLite 和远端仓库，
        只处理有变动的 Markdown。关闭本页也不会中断，手机/电脑/任何浏览器都能看到同一份结果。
      </p>
      <button className="btn-primary" onClick={onStart}>
        <Icon.Refresh /> <span>启动同步</span>
      </button>
      {error && (
        <div className="gh-sync-error">
          <strong>启动失败：</strong>
          <pre>{error}</pre>
          <p className="gh-sync-hint">
            请在 Zeabur 控制台确认环境变量 <code>GITHUB_REPO</code>、<code>GITHUB_TOKEN</code>、
            <code>GITHUB_BRANCH</code>、<code>LLM_API_KEY</code> 均已设置，并已挂载 Volume 到
            <code>DATA_DIR</code>（默认 <code>/data</code>）。
          </p>
        </div>
      )}
    </div>
  );
}
