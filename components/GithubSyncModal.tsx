'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';
import { pullSnapshotFromCloud } from '@/lib/cloud-sync';
import { getPollFailurePlan } from '@/lib/github-sync-poll';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import { withRequestId } from '@/lib/trace-client';
import {
  buildSyncStageItems,
  getCurrentFileDisplay,
  getSyncStatusCopy,
} from '@/lib/github-sync-ui';
import { useModalKeyboard } from '@/lib/hooks/useModalKeyboard';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

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

class PollHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function GithubSyncModal() {
  const open = useAppStore((s) => s.githubSyncOpen);
  const close = useAppStore((s) => s.closeGithubSync);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pollIssue, setPollIssue] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulledAfterDoneRef = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useModalKeyboard(open, close);
  useFocusTrap(modalRef, open);

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setError(null);
      setPollIssue(null);
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

  const pollOnce = useCallback(async (jobId: string, consecutiveFailures = 0) => {
    try {
      const res = await fetch(`/api/sync/status?jobId=${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
        headers: withRequestId(getAdminAuthHeaders()),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PollHttpError(res.status, `状态查询失败 (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as JobStatus;
      setPollIssue(null);
      setJob(data);
      if (data.status === 'running') {
        setPhase('running');
        pollTimerRef.current = setTimeout(() => void pollOnce(jobId, 0), POLL_INTERVAL_MS);
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
      const plan = getPollFailurePlan({
        status: e instanceof PollHttpError ? e.status : undefined,
        message: msg,
        consecutiveFailures,
      });

      if (plan.shouldRetry) {
        setPollIssue(plan.userMessage);
        pollTimerRef.current = setTimeout(
          () => void pollOnce(jobId, plan.nextFailureCount),
          plan.retryDelayMs,
        );
        return;
      }

      setPollIssue(null);
      setError(msg);
      setPhase('failed');
    }
  }, []);

  const start = useCallback(async () => {
    setPhase('starting');
    setError(null);
    setPollIssue(null);
    try {
      const res = await fetch('/api/sync/github/run', {
        method: 'POST',
        headers: withRequestId(getAdminAuthHeaders()),
      });
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
  const stageItems = buildSyncStageItems({ phase, pulling, job });
  const currentFile = getCurrentFileDisplay(job?.current ?? null);
  const statusCopy = getSyncStatusCopy({ phase, pulling, job, pollIssue, error });

  return (
    <div className="modal-overlay visible" onClick={canClose ? close : undefined}>
      <div
        className="modal gh-sync-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gh-sync-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />
        <header className="gh-sync-header">
          <div className="gh-sync-header-row">
            <div className="gh-sync-title">
              <span className="gh-sync-title-icon">
                <Icon.Github />
              </span>
              <div>
                <p className="gh-sync-eyebrow">{statusCopy.eyebrow}</p>
                <h2 id="gh-sync-title">从 GitHub 同步</h2>
              </div>
            </div>
            <button
              className="icon-btn gh-sync-close"
              onClick={close}
              disabled={!canClose}
              aria-label="关闭"
              title={!canClose ? '同步任务启动中，请稍候…' : undefined}
            >
              ×
            </button>
          </div>
          <p className="gh-sync-subtitle">{statusCopy.description}</p>
        </header>

        {(phase === 'idle' || (phase === 'failed' && !job)) && (
          <IdleView onStart={start} error={error} />
        )}

        {phase === 'starting' && <StartingView stageItems={stageItems} />}

        {(phase === 'running' || phase === 'done' || phase === 'failed') && job && (
          <>
            <section className="gh-sync-panel gh-sync-stage-card">
              <div className="gh-sync-panel-head">
                <div>
                  <p className="gh-sync-panel-kicker">同步阶段</p>
                  <h3>现在进行到哪一步</h3>
                </div>
                <div className="gh-sync-badge">共 {job.total} 个文件</div>
              </div>
              <div className="gh-sync-stage-list" aria-label="同步阶段">
                {stageItems.map((item, index) => (
                  <div
                    key={item.id}
                    className={`gh-sync-stage-item ${item.status}`}
                    aria-current={item.status === 'current' ? 'step' : undefined}
                  >
                    <div className="gh-sync-stage-dot" />
                    <span className="gh-sync-stage-label">{item.label}</span>
                    {index < stageItems.length - 1 && <span className="gh-sync-stage-line" />}
                  </div>
                ))}
              </div>
            </section>

            <section className="gh-sync-panel gh-sync-focus-card">
              <div className="gh-sync-panel-head">
                <div>
                  <p className="gh-sync-panel-kicker">当前处理文件</p>
                  <h3>
                    {currentFile.counter ? `当前文件 ${currentFile.counter}` : '正在准备同步内容'}
                  </h3>
                </div>
                {job.total > 0 && (
                  <div className="gh-sync-mini-stats">
                    已处理 {job.done + job.failed} / {job.total}
                  </div>
                )}
              </div>
              <p className="gh-sync-focus-path" title={currentFile.path ?? job.current ?? ''}>
                {currentFile.path ?? job.current ?? '服务端正在准备第一批同步内容…'}
              </p>
              {phase === 'running' && pollIssue && (
                <p className="gh-sync-inline-hint">{pollIssue}</p>
              )}
            </section>

            <section className="gh-sync-panel gh-sync-progress-card">
              <div className="gh-sync-progress-meta">
                <div>
                  <p className="gh-sync-panel-kicker">同步进度</p>
                  <h3>{progressPct}%</h3>
                </div>
                <div className="gh-sync-progress-stats">
                  <span>
                    成功 <strong>{job.done}</strong>
                  </span>
                  <span>
                    失败 <strong>{job.failed}</strong>
                  </span>
                </div>
              </div>
              <div className="gh-sync-progress-bar" aria-label="同步进度">
                <div className="gh-sync-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </section>

            {error && job.status === 'failed' && (
              <div className="gh-sync-error gh-sync-panel">
                <div className="gh-sync-panel-head">
                  <div>
                    <p className="gh-sync-panel-kicker">失败原因</p>
                    <h3>需要先处理这个问题</h3>
                  </div>
                </div>
                <ErrorDetail error={error} />
                <p className="gh-sync-hint">
                  常见原因：<code>GITHUB_TOKEN</code>、<code>GITHUB_REPO</code> 未配置，或
                  <code>LLM_API_KEY</code> 在 Zeabur 环境变量里缺失。
                </p>
              </div>
            )}

            <section className="gh-sync-panel gh-sync-log-card">
              <div className="gh-sync-panel-head">
                <div>
                  <p className="gh-sync-panel-kicker">同步时间线</p>
                  <h3>服务端正在回传这些结果</h3>
                </div>
              </div>
              <div className="gh-sync-list gh-sync-log">
                {job.log.length === 0 ? (
                  <div className="gh-sync-empty-state">
                    <p className="gh-sync-empty-title">日志还在生成中</p>
                    <p className="gh-sync-empty-desc">首次同步通常会先扫描仓库，再逐步写回进度。</p>
                  </div>
                ) : (
                  job.log
                    .slice()
                    .reverse()
                    .map((entry, i) => (
                      <div
                        key={`${entry.path}-${entry.at}-${i}`}
                        className={`gh-sync-timeline-item ${entry.status}`}
                      >
                        <span className="gh-sync-timeline-dot" aria-hidden="true" />
                        <div className="gh-sync-timeline-body">
                          <div className="gh-sync-timeline-row">
                            <span className="gh-sync-timeline-label">
                              {entry.status === 'failed'
                                ? '失败'
                                : entry.status === 'success'
                                  ? '成功'
                                  : '提示'}
                            </span>
                            <span className="gh-sync-timeline-path" title={entry.path}>
                              {entry.path}
                            </span>
                          </div>
                          {entry.message && (
                            <p className="gh-sync-timeline-message">{entry.message}</p>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
            </section>

            <footer className="gh-sync-footer">
              {phase === 'running' && (
                <>
                  <span className="gh-sync-progress-text">
                    关闭窗口不会中断，服务端会继续同步。
                  </span>
                  <button className="btn-primary" onClick={close}>
                    后台继续
                  </button>
                </>
              )}
              {phase === 'done' && (
                <>
                  <span className="gh-sync-progress-text">
                    {pulling ? '正在拉取最新数据到本地…' : '最新数据已经同步到当前设备。'}
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
      <section className="gh-sync-panel gh-sync-intro-card">
        <div className="gh-sync-panel-head">
          <div>
            <p className="gh-sync-panel-kicker">同步说明</p>
            <h3>小范围、清晰、可靠地同步远端 Markdown</h3>
          </div>
        </div>
        <p className="gh-sync-lede">
          服务端会先扫描 GitHub 仓库，再只处理真正有变动的内容。你可以随时关闭窗口，同步不会中断，
          手机、电脑和其他浏览器稍后看到的都会是同一份结果。
        </p>
      </section>
      <div className="gh-sync-footer gh-sync-footer-start">
        <span className="gh-sync-progress-text">准备好后就可以开始本次同步。</span>
        <button className="btn-primary" onClick={onStart}>
          <Icon.Refresh /> <span>启动同步</span>
        </button>
      </div>
      {error && (
        <div className="gh-sync-error gh-sync-panel">
          <div className="gh-sync-panel-head">
            <div>
              <p className="gh-sync-panel-kicker">启动失败</p>
              <h3>服务端还没成功建立任务</h3>
            </div>
          </div>
          <ErrorDetail error={error} />
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

function StartingView({
  stageItems,
}: {
  stageItems: Array<{ id: string; label: string; status: 'done' | 'current' | 'upcoming' }>;
}) {
  return (
    <div className="gh-sync-idle">
      <section className="gh-sync-panel gh-sync-stage-card">
        <div className="gh-sync-panel-head">
          <div>
            <p className="gh-sync-panel-kicker">同步阶段</p>
            <h3>服务端正在建立同步任务</h3>
          </div>
        </div>
        <div className="gh-sync-stage-list" aria-label="同步阶段">
          {stageItems.map((item, index) => (
            <div
              key={item.id}
              className={`gh-sync-stage-item ${item.status}`}
              aria-current={item.status === 'current' ? 'step' : undefined}
            >
              <div className="gh-sync-stage-dot" />
              <span className="gh-sync-stage-label">{item.label}</span>
              {index < stageItems.length - 1 && <span className="gh-sync-stage-line" />}
            </div>
          ))}
        </div>
      </section>

      <section className="gh-sync-panel gh-sync-focus-card">
        <div className="gh-sync-panel-head">
          <div>
            <p className="gh-sync-panel-kicker">当前处理文件</p>
            <h3>正在连接服务端</h3>
          </div>
        </div>
        <div className="gh-sync-skeleton gh-sync-skeleton-lg" />
        <div className="gh-sync-skeleton gh-sync-skeleton-sm" />
      </section>
    </div>
  );
}

function ErrorDetail({ error }: { error: string }) {
  const [expanded, setExpanded] = useState(false);
  // Attempt to extract a user-friendly summary from the error string
  // Take first line or up to 120 chars as the main message
  const lines = error.split('\n');
  const mainMessage = lines[0]?.slice(0, 200) ?? error;
  const hasDetails = error.length > mainMessage.length || lines.length > 1;

  return (
    <div className="gh-sync-error-detail">
      <p className="gh-sync-error-main">{mainMessage}</p>
      {hasDetails && (
        <div className="gh-sync-error-collapse">
          <button className="gh-sync-error-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起详情' : '查看详情'}
          </button>
          {expanded && <pre className="gh-sync-error-pre">{error}</pre>}
        </div>
      )}
    </div>
  );
}
