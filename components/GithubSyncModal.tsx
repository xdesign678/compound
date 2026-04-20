'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';
import {
  buildSyncPlan,
  fetchRemoteFileList,
  runGithubSyncQueue,
  type SyncFile,
} from '@/lib/github-sync-client';

type Phase = 'idle' | 'scanning' | 'review' | 'running' | 'done';

export function GithubSyncModal() {
  const open = useAppStore((s) => s.githubSyncOpen);
  const close = useAppStore((s) => s.closeGithubSync);
  const markFresh = useAppStore((s) => s.markFresh);

  const [phase, setPhase] = useState<Phase>('idle');
  const [repo, setRepo] = useState<string>('');
  const [plan, setPlan] = useState<SyncFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stopFlagRef = useRef(false);
  const freshAccRef = useRef<string[]>([]);

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setPhase('idle');
      setPlan([]);
      setError(null);
      setRepo('');
      stopFlagRef.current = false;
      freshAccRef.current = [];
    }
  }, [open]);

  const stats = useMemo(() => {
    const total = plan.length;
    const create = plan.filter((f) => f.action === 'create').length;
    const update = plan.filter((f) => f.action === 'update' && f.status !== 'unchanged').length;
    const unchanged = plan.filter((f) => f.status === 'unchanged').length;
    const pending = plan.filter((f) => f.selected && f.status === 'pending').length;
    const success = plan.filter((f) => f.status === 'success').length;
    const failed = plan.filter((f) => f.status === 'failed').length;
    return { total, create, update, unchanged, pending, success, failed };
  }, [plan]);

  const scan = useCallback(async () => {
    setPhase('scanning');
    setError(null);
    try {
      const res = await fetchRemoteFileList();
      setRepo(`${res.repo}@${res.branch}`);
      const built = await buildSyncPlan(res.files);
      setPlan(built);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, []);

  const start = useCallback(async () => {
    stopFlagRef.current = false;
    freshAccRef.current = [];
    setPhase('running');

    await runGithubSyncQueue({
      plan,
      shouldStop: () => stopFlagRef.current,
      onUpdate: (file, newIds) => {
        setPlan((prev) => prev.map((f) => (f.path === file.path ? file : f)));
        if (newIds && newIds.length > 0) {
          freshAccRef.current.push(...newIds);
        }
      },
    });

    if (freshAccRef.current.length > 0) {
      markFresh(freshAccRef.current);
    }
    setPhase('done');
  }, [plan, markFresh]);

  const toggleFile = (path: string) => {
    setPlan((prev) =>
      prev.map((f) =>
        f.path === path && f.status === 'pending' ? { ...f, selected: !f.selected } : f
      )
    );
  };

  const selectAllPending = () => {
    setPlan((prev) => prev.map((f) => (f.status === 'pending' ? { ...f, selected: true } : f)));
  };

  const clearAllPending = () => {
    setPlan((prev) => prev.map((f) => (f.status === 'pending' ? { ...f, selected: false } : f)));
  };

  const stop = () => {
    stopFlagRef.current = true;
  };

  if (!open) return null;

  return (
    <div className="modal-overlay visible" onClick={phase === 'running' ? undefined : close}>
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
            disabled={phase === 'running'}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        {phase === 'idle' && (
          <IdleView onScan={scan} error={error} />
        )}

        {phase === 'scanning' && <ScanningView />}

        {(phase === 'review' || phase === 'running' || phase === 'done') && (
          <>
            <div className="gh-sync-meta">
              <span className="gh-sync-repo">📦 {repo}</span>
              <span className="gh-sync-stats">
                共 {stats.total} 个文件 ·{' '}
                {phase === 'review' ? (
                  <>
                    待同步 <strong>{stats.pending}</strong> · 已是最新 {stats.unchanged}
                  </>
                ) : (
                  <>
                    成功 <strong>{stats.success}</strong> · 失败 {stats.failed}
                  </>
                )}
              </span>
            </div>

            {phase === 'review' && stats.pending === 0 && (
              <div className="gh-sync-empty">
                <p>🎉 所有文件都是最新的，无需同步。</p>
              </div>
            )}

            {phase === 'review' && stats.pending > 0 && (
              <div className="gh-sync-toolbar">
                <button className="btn-link" onClick={selectAllPending}>全选待同步</button>
                <button className="btn-link" onClick={clearAllPending}>全不选</button>
                <span className="gh-sync-toolbar-spacer" />
                <span>
                  新增 <strong>{stats.create}</strong> · 更新{' '}
                  <strong>{stats.update}</strong>
                </span>
              </div>
            )}

            <div className="gh-sync-list">
              {plan.map((f) => (
                <FileRow key={f.path} file={f} phase={phase} onToggle={toggleFile} />
              ))}
            </div>

            <footer className="gh-sync-footer">
              {phase === 'review' && (
                <>
                  <button className="btn-ghost" onClick={close}>取消</button>
                  <button
                    className="btn-primary"
                    onClick={start}
                    disabled={stats.pending === 0}
                  >
                    开始同步{stats.pending > 0 ? ` (${stats.pending})` : ''}
                  </button>
                </>
              )}
              {phase === 'running' && (
                <>
                  <span className="gh-sync-progress-text">
                    进行中… 成功 {stats.success} / 失败 {stats.failed}
                  </span>
                  <button className="btn-ghost" onClick={stop}>停止</button>
                </>
              )}
              {phase === 'done' && (
                <>
                  <span className="gh-sync-progress-text">
                    ✅ 完成：成功 {stats.success} / 失败 {stats.failed}
                  </span>
                  <button className="btn-primary" onClick={close}>关闭</button>
                </>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

function IdleView({ onScan, error }: { onScan: () => void; error: string | null }) {
  return (
    <div className="gh-sync-idle">
      <p className="gh-sync-lede">
        点下面按钮扫描你在服务端配置的 GitHub 仓库，自动识别新增 / 变更的 Markdown
        文件，然后批量喂给知识库。
      </p>
      <button className="btn-primary" onClick={onScan}>
        <Icon.Refresh /> <span>扫描远端仓库</span>
      </button>
      {error && (
        <div className="gh-sync-error">
          <strong>扫描失败：</strong>
          <pre>{error}</pre>
          <p className="gh-sync-hint">
            请在 Zeabur 控制台确认已设置环境变量 <code>GITHUB_REPO</code>、
            <code>GITHUB_TOKEN</code>、<code>GITHUB_BRANCH</code>。
          </p>
        </div>
      )}
    </div>
  );
}

function ScanningView() {
  return (
    <div className="gh-sync-idle">
      <p className="gh-sync-lede">🔍 正在从 GitHub 读取文件清单…</p>
    </div>
  );
}

function FileRow({
  file,
  phase,
  onToggle,
}: {
  file: SyncFile;
  phase: Phase;
  onToggle: (path: string) => void;
}) {
  const isReview = phase === 'review';
  const canToggle = isReview && file.status === 'pending';

  const statusLabel = (() => {
    switch (file.status) {
      case 'unchanged': return { text: '已是最新', cls: 'unchanged' };
      case 'pending':   return { text: file.action === 'create' ? '新增' : '更新', cls: file.action };
      case 'running':   return { text: '同步中…', cls: 'running' };
      case 'success':   return { text: `✓ +${file.newConcepts ?? 0}新${file.updatedConcepts ? ` ${file.updatedConcepts}更` : ''}`, cls: 'success' };
      case 'failed':    return { text: '× 失败', cls: 'failed' };
      default:          return { text: '', cls: '' };
    }
  })();

  return (
    <div className={`gh-sync-row ${file.status}`}>
      <label className={`gh-sync-check ${canToggle ? 'active' : 'disabled'}`}>
        <input
          type="checkbox"
          checked={file.selected}
          disabled={!canToggle}
          onChange={() => onToggle(file.path)}
        />
        <span className="gh-sync-path" title={file.path}>{file.path}</span>
      </label>
      <span className={`gh-sync-status ${statusLabel.cls}`}>{statusLabel.text}</span>
      {file.error && <div className="gh-sync-row-error">{file.error}</div>}
    </div>
  );
}
