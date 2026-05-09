'use client';

import { useEffect, useRef, useState } from 'react';
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
  onRetryDeadLetter: (jobId: string) => void;
  onDeleteDeadLetter: (jobId: string) => void;
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
  onRetryDeadLetter,
  onDeleteDeadLetter,
}: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [opsTab, setOpsTab] = useState<'dlq' | 'webhooks'>('dlq');
  useEffect(() => {
    if (!open) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = originalOverflow;
      openerRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const events = dashboard?.events ?? [];
  const pipeline = dashboard?.pipeline ?? [];
  const items = dashboard?.activeItems ?? [];
  const run = dashboard?.activeRun ?? dashboard?.latestRuns?.[0] ?? null;
  const failedFiles = dashboard?.itemSummary?.failed ?? 0;
  const throughput = dashboard?.throughput ?? [];
  const dlq = dashboard?.dlq;
  const deliveries = dashboard?.webhookDeliveries ?? [];
  const dlqCount = dlq?.count ?? 0;
  const dlqStageCount = dlq ? Object.keys(dlq.byStage).length : 0;

  return (
    <div className="sync-v2-drawer-backdrop" onClick={onClose}>
      <aside
        className="sync-v2-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-v2-drawer-title"
        aria-describedby="sync-v2-drawer-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sync-v2-drawer-head">
          <div>
            <h2 id="sync-v2-drawer-title">高级抽屉</h2>
            <p id="sync-v2-drawer-desc">
              底层操作、死信队列、webhook 投递历史、完整文件表和事件流。
            </p>
          </div>
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

          <section className="sync-v2-drawer-section" aria-labelledby="sync-v2-queue-title">
            <div className="sync-v2-drawer-section-head">
              <h3 id="sync-v2-queue-title">死信与投递历史</h3>
              <span className="sync-v2-drawer-summary" aria-live="polite">
                死信 {dlqCount} · 投递 {deliveries.length}
              </span>
            </div>
            <div
              className="sync-v2-drawer-tabs"
              role="tablist"
              aria-label="高级队列视图"
              aria-orientation="horizontal"
            >
              <button
                id="sync-v2-tab-dlq"
                type="button"
                role="tab"
                aria-selected={opsTab === 'dlq'}
                aria-controls="sync-v2-panel-dlq"
                className={opsTab === 'dlq' ? 'active' : ''}
                tabIndex={opsTab === 'dlq' ? 0 : -1}
                onClick={() => setOpsTab('dlq')}
              >
                死信 · {dlqCount}
              </button>
              <button
                id="sync-v2-tab-webhooks"
                type="button"
                role="tab"
                aria-selected={opsTab === 'webhooks'}
                aria-controls="sync-v2-panel-webhooks"
                className={opsTab === 'webhooks' ? 'active' : ''}
                tabIndex={opsTab === 'webhooks' ? 0 : -1}
                onClick={() => setOpsTab('webhooks')}
              >
                投递历史 · {deliveries.length}
              </button>
            </div>

            {opsTab === 'dlq' ? (
              <div
                id="sync-v2-panel-dlq"
                role="tabpanel"
                aria-labelledby="sync-v2-tab-dlq"
                className="sync-v2-drawer-panel"
              >
                <p className="sync-v2-drawer-summary">
                  {dlqCount > 0
                    ? `${dlqCount} 个死信任务，分布在 ${dlqStageCount} 个阶段。`
                    : '当前没有死信任务。'}
                </p>
                {dlq && Object.keys(dlq.byStage).length > 0 ? (
                  <div className="sync-v2-drawer-actions">
                    {Object.entries(dlq.byStage).map(([stage, count]) => (
                      <span key={stage} className="sync-v2-badge tone-bad">
                        {stage} · {count}
                      </span>
                    ))}
                  </div>
                ) : null}
                {dlq?.recent?.length ? (
                  <ul className="sync-v2-event-log" aria-label="死信任务列表">
                    {dlq.recent.map((job) => (
                      <li key={job.id} className="sync-v2-event tone-bad">
                        <div className="sync-v2-event-head">
                          <span className="sync-v2-badge tone-bad">{job.stage}</span>
                          <span className="sync-v2-event-when">{fmtDate(job.dead_letter_at)}</span>
                        </div>
                        {job.source_path ? (
                          <code className="sync-v2-event-path">{job.source_path}</code>
                        ) : null}
                        <p>{job.error || '分析任务进入死信队列'}</p>
                        <div className="sync-v2-event-actions">
                          <button
                            type="button"
                            className="sync-v2-btn sync-v2-btn-tiny"
                            disabled={busy}
                            onClick={() => onRetryDeadLetter(job.id)}
                            aria-label={`重新入队 ${job.source_path ?? job.id}`}
                          >
                            重新入队
                          </button>
                          <button
                            type="button"
                            className="sync-v2-btn sync-v2-btn-tiny sync-v2-btn-danger"
                            disabled={busy}
                            onClick={() => onDeleteDeadLetter(job.id)}
                            aria-label={`删除死信 ${job.source_path ?? job.id}`}
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sync-v2-empty">暂无死信任务。</p>
                )}
              </div>
            ) : deliveries.length > 0 ? (
              <div
                id="sync-v2-panel-webhooks"
                role="tabpanel"
                aria-labelledby="sync-v2-tab-webhooks"
                className="sync-v2-drawer-panel"
              >
                <p className="sync-v2-drawer-summary">
                  最近 {deliveries.length} 条 webhook 投递记录。
                </p>
                <ul className="sync-v2-event-log" aria-label="webhook 投递历史">
                  {deliveries.map((delivery) => (
                    <li
                      key={delivery.delivery_id}
                      className={`sync-v2-event tone-${badgeTone(delivery.status)}`}
                    >
                      <div className="sync-v2-event-head">
                        <span className={`sync-v2-badge tone-${badgeTone(delivery.status)}`}>
                          {delivery.status}
                        </span>
                        <span className="sync-v2-badge tone-neutral">{delivery.event}</span>
                        <span className="sync-v2-event-when">{fmtDate(delivery.received_at)}</span>
                      </div>
                      <code className="sync-v2-event-path">{delivery.delivery_id}</code>
                      {delivery.job_id ? <p>jobId: {delivery.job_id}</p> : null}
                      {delivery.error ? <p>{delivery.error}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div
                id="sync-v2-panel-webhooks"
                role="tabpanel"
                aria-labelledby="sync-v2-tab-webhooks"
                className="sync-v2-drawer-panel"
              >
                <p className="sync-v2-empty">暂无 webhook 投递记录。</p>
              </div>
            )}
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
              <ul className="sync-v2-event-log" aria-label="同步事件流">
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
