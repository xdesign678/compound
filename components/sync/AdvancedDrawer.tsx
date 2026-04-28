'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { STATUS_TEXT, badgeTone, fmtDate, type Dashboard, type SyncEvent } from './types';
import FileTable from './FileTable';
import PipelineStrip from './PipelineStrip';
import Sparkline from './Sparkline';

interface Props {
  open: boolean;
  busy: boolean;
  paused: boolean;
  dashboard: Dashboard | null;
  onClose: () => void;
  onRetryItem: (itemId: string) => void;
  onTogglePaused: () => void;
  onRunWorker: () => void;
  onCancel: () => void;
  onRetryAll: () => void;
}

/**
 * The advanced drawer hides everything power-user / ops-only behind a
 * single explicit affordance. Daily users do not need to think about raw
 * stages, full event log, throughput sparkline, manual worker triggering,
 * or the 9-column file table — they can stay in the main story view.
 */
export default function AdvancedDrawer({
  open,
  busy,
  paused,
  dashboard,
  onClose,
  onRetryItem,
  onTogglePaused,
  onRunWorker,
  onCancel,
  onRetryAll,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const events = dashboard?.events ?? [];
  const pipeline = dashboard?.pipeline ?? [];
  const items = dashboard?.activeItems ?? [];
  const run = dashboard?.activeRun ?? dashboard?.latestRuns?.[0] ?? null;
  const failedFiles = dashboard?.itemSummary?.failed ?? 0;
  const throughput = dashboard?.throughput ?? [];

  return (
    <div
      className="sync-v2-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="高级抽屉"
      onClick={onClose}
    >
      <aside className="sync-v2-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="sync-v2-drawer-head">
          <h2>高级抽屉</h2>
          <button
            ref={closeRef}
            type="button"
            className="sync-v2-btn sync-v2-btn-ghost"
            onClick={onClose}
            aria-label="关闭抽屉"
          >
            关闭
          </button>
        </header>

        <div className="sync-v2-drawer-body">
          <section className="sync-v2-drawer-section" aria-label="底层操作">
            <h3>底层操作</h3>
            <div className="sync-v2-drawer-actions">
              <button
                type="button"
                className="sync-v2-btn"
                disabled={busy}
                onClick={onRunWorker}
                title="单独唤醒分析 worker（不触发 GitHub 同步）"
              >
                单独跑 worker
              </button>
              <button
                type="button"
                className="sync-v2-btn"
                disabled={busy || failedFiles === 0}
                onClick={onRetryAll}
                title="把 failed/cancelled 的分析任务重新加入队列"
              >
                重试所有失败 {failedFiles > 0 ? `· ${failedFiles}` : ''}
              </button>
              <button
                type="button"
                className="sync-v2-btn sync-v2-btn-danger"
                disabled={busy || run?.status !== 'running'}
                onClick={onCancel}
              >
                取消运行
              </button>
              <button
                type="button"
                className={`sync-v2-btn ${paused ? 'sync-v2-btn-active' : ''}`}
                onClick={onTogglePaused}
              >
                {paused ? '已暂停轮询 ●' : '暂停轮询'}
              </button>
              <Link className="sync-v2-btn" href="/review">
                审核队列
              </Link>
            </div>
          </section>

          <section className="sync-v2-drawer-section" aria-label="14 个原始阶段">
            <h3>原始阶段（pipeline）</h3>
            {pipeline.length > 0 ? (
              <PipelineStrip stages={pipeline} />
            ) : (
              <p className="sync-v2-empty">暂无阶段数据。</p>
            )}
            {throughput.length > 0 ? (
              <div className="sync-v2-drawer-throughput">
                <span>近 30 分钟通量</span>
                <Sparkline data={throughput} />
              </div>
            ) : null}
          </section>

          <section className="sync-v2-drawer-section" aria-label="完整文件表">
            <h3>完整文件表</h3>
            <FileTable
              items={items}
              stageFilter={null}
              onClearStageFilter={() => undefined}
              busy={busy}
              onRetryItem={onRetryItem}
            />
          </section>

          <section className="sync-v2-drawer-section" aria-label="事件流">
            <h3>事件流 · {events.length}</h3>
            {events.length === 0 ? (
              <p className="sync-v2-empty">暂无事件。</p>
            ) : (
              <ul className="sync-v2-event-log">
                {events.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function EventRow({ event }: { event: SyncEvent }) {
  return (
    <li className={`sync-v2-event tone-${badgeTone(event.level)}`}>
      <div className="sync-v2-event-head">
        <span className={`sync-v2-badge tone-${badgeTone(event.level)}`}>
          {STATUS_TEXT[event.level] || event.level}
        </span>
        {event.stage ? <span className="sync-v2-badge tone-neutral">{event.stage}</span> : null}
        <span className="sync-v2-event-when">{fmtDate(event.at)}</span>
      </div>
      {event.path ? <code className="sync-v2-event-path">{event.path}</code> : null}
      <p>{event.message}</p>
    </li>
  );
}
