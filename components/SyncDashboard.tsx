'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';
import { withRequestId } from '@/lib/trace-client';
import HeartbeatPill from './sync/HeartbeatPill';
import PipelineStrip from './sync/PipelineStrip';
import ErrorGroups from './sync/ErrorGroups';
import CoverageBars from './sync/CoverageBars';
import FileTable from './sync/FileTable';
import Sparkline from './sync/Sparkline';
import { ToastProvider, useToast } from './sync/Toast';
import {
  STATUS_TEXT,
  asNumber,
  badgeTone,
  fmtDate,
  fmtDuration,
  type Dashboard,
} from './sync/types';

const POLL_RUNNING_MS = 2_000;
const POLL_IDLE_MS = 10_000;
const EVENTS_PREVIEW = 8;

type ApiResult = { message?: string; error?: string } & Record<string, unknown>;

async function postJson(path: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: withRequestId({ ...getAdminAuthHeaders(), 'Content-Type': 'application/json' }),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as ApiResult | null;
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json ?? {};
}

function progress(done: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
}

function computeThroughput(buckets: { done: number; failed: number }[]): {
  rate: number;
  failed: number;
} {
  if (buckets.length === 0) return { rate: 0, failed: 0 };
  // Average of the last 5 buckets (5 minutes).
  const tail = buckets.slice(-5);
  const done = tail.reduce((s, b) => s + b.done, 0);
  const failed = tail.reduce((s, b) => s + b.failed, 0);
  return { rate: done / Math.max(tail.length, 1), failed };
}

type TabKey = 'files' | 'errors' | 'coverage' | 'events';

function DashboardInner() {
  const toast = useToast();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<TabKey>('files');
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [eventsExpanded, setEventsExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/dashboard', {
        headers: withRequestId(getAdminAuthHeaders()),
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as ApiResult | null;
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setDashboard((await res.json()) as Dashboard);
      setLoadError('');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const runAction = useCallback(
    async (
      label: string,
      title: string,
      fn: () => Promise<ApiResult>,
      successFallback?: string,
    ) => {
      setBusy(label);
      try {
        const result = await fn();
        await load();
        const message = result.message || successFallback || `${title}已完成`;
        toast.push('success', title, message);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.push('error', `${title}失败`, message);
      } finally {
        setBusy('');
      }
    },
    [load, toast],
  );

  // Adaptive polling: 2s while a run is active, 10s when idle, paused on demand.
  useEffect(() => {
    if (paused) return;
    void load();
    const isRunning = dashboard?.activeRun?.status === 'running';
    const interval = isRunning ? POLL_RUNNING_MS : POLL_IDLE_MS;
    const timer = window.setInterval(() => void load(), interval);
    return () => window.clearInterval(timer);
  }, [load, paused, dashboard?.activeRun?.status]);

  const run = dashboard?.activeRun ?? dashboard?.latestRuns?.[0] ?? null;
  const coverage = dashboard?.coverage ?? {};
  const doneCount = (run?.done_files ?? 0) + (run?.failed_files ?? 0);
  const percent = run ? progress(doneCount, run.changed_files) : 0;
  const allEvents = dashboard?.events ?? [];
  const visibleEvents = eventsExpanded ? allEvents : allEvents.slice(0, EVENTS_PREVIEW);
  const hasMoreEvents = allEvents.length > EVENTS_PREVIEW;
  const errorGroups = dashboard?.errorGroups ?? [];
  const pipeline = dashboard?.pipeline ?? [];
  const health = dashboard?.health;
  const summary = dashboard?.itemSummary;
  const throughput = useMemo(
    () => computeThroughput(dashboard?.throughput ?? []),
    [dashboard?.throughput],
  );
  const failedFilesCount = summary?.failed ?? run?.failed_files ?? 0;
  const queuedFilesCount = summary?.queued ?? 0;
  const runningFilesCount = summary?.running ?? 0;
  const failureRate =
    run && run.changed_files > 0
      ? ((run.failed_files / run.changed_files) * 100).toFixed(1)
      : '0.0';
  const runtimeMs = useMemo(() => {
    if (!run?.started_at) return null;
    if (run.status === 'running') return Date.now() - run.started_at;
    return (run.finished_at ?? run.started_at) - run.started_at;
  }, [run?.started_at, run?.finished_at, run?.status]);

  return (
    <main className="ops-page">
      <header className="ops-topbar">
        <div className="ops-topbar-meta">
          <div className="ops-kicker">Compound Ops</div>
          <h1>同步控制台</h1>
          <div className="ops-topbar-status">
            <HeartbeatPill run={run} health={health} />
            {run ? (
              <span className="ops-topbar-meta-line">
                {run.repo ? `${run.repo}@${run.branch || 'main'}` : '本地'}
                {runtimeMs != null ? ` · 运行 ${fmtDuration(runtimeMs)}` : ''}
              </span>
            ) : (
              <span className="ops-topbar-meta-line">暂无任务</span>
            )}
          </div>
          <p>{run?.current || run?.error || '同步、分析、向量索引和人工审核的实时状态。'}</p>
        </div>

        <div className="ops-actions ops-actions-v2">
          <div className="ops-actions-group" role="group" aria-label="主操作">
            <button
              type="button"
              className="ops-btn primary"
              disabled={Boolean(busy)}
              onClick={() => runAction('sync', '立即同步', () => postJson('/api/sync/github/run'))}
              title="扫描 GitHub 远端仓库并把变更加入分析队列"
            >
              {busy === 'sync' ? '启动中…' : '立即同步'}
            </button>
            <button
              type="button"
              className="ops-btn"
              disabled={Boolean(busy)}
              onClick={() => runAction('worker', '跑分析', () => postJson('/api/sync/worker'))}
              title="把分析队列里的任务推给 worker，并尝试回收孤儿任务"
            >
              {busy === 'worker' ? '启动中…' : '跑分析'}
            </button>
          </div>
          <span className="ops-actions-divider" aria-hidden="true" />
          <div className="ops-actions-group" role="group" aria-label="恢复">
            <button
              type="button"
              className="ops-btn good"
              disabled={Boolean(busy) || failedFilesCount === 0}
              onClick={() =>
                runAction('retry', '重试失败', () =>
                  postJson('/api/sync/retry', { runId: run?.id }),
                )
              }
              title="把 failed/cancelled 的分析任务重新加入队列"
            >
              重试失败 {failedFilesCount > 0 ? `· ${failedFilesCount}` : ''}
            </button>
          </div>
          <span className="ops-actions-divider" aria-hidden="true" />
          <div className="ops-actions-group" role="group" aria-label="危险">
            <button
              type="button"
              className="ops-btn danger"
              disabled={Boolean(busy) || run?.status !== 'running'}
              onClick={() => runAction('cancel', '取消运行', () => postJson('/api/sync/cancel'))}
              title="终止当前运行并把所有 in-flight 任务标为 cancelled"
            >
              取消
            </button>
          </div>
          <span className="ops-actions-divider" aria-hidden="true" />
          <div className="ops-actions-group" role="group" aria-label="导航">
            <button
              type="button"
              className={`ops-btn subtle${paused ? ' active' : ''}`}
              onClick={() => setPaused((v) => !v)}
              title={paused ? '当前已暂停轮询' : '点击暂停 2s 轮询'}
            >
              {paused ? '已暂停 ●' : '暂停轮询'}
            </button>
            <Link className="ops-btn" href="/review">
              审核队列
            </Link>
            <Link className="ops-btn subtle" href="/">
              返回
            </Link>
          </div>
        </div>
      </header>

      {loadError ? <div className="ops-alert">{loadError}</div> : null}
      {health?.stalled ? (
        <div className="ops-alert ops-alert-warn">
          运行已停滞 {fmtDuration(health.stalledFor)}，建议点「跑分析」唤醒 worker，或检查上游 LLM
          服务。
        </div>
      ) : null}

      <section className="ops-stat-grid" aria-label="同步概览">
        <div className="ops-stat">
          <span>当前状态</span>
          <strong>{run ? STATUS_TEXT[run.status] || run.status : '空闲'}</strong>
          <em>
            {run?.repo ? `${run.repo}@${run.branch || 'main'}` : '暂无任务'}
            {runtimeMs != null ? ` · ${fmtDuration(runtimeMs)}` : ''}
          </em>
        </div>
        <div className="ops-stat">
          <span>同步进度</span>
          <strong>{percent}%</strong>
          <em>
            完成 {run?.done_files ?? 0} · 失败 {run?.failed_files ?? 0} · 排队{' '}
            {queuedFilesCount + runningFilesCount}
          </em>
          {run ? (
            <div className="ops-progress-inline" aria-label={`同步进度 ${percent}%`}>
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
        <div className="ops-stat">
          <span>通量</span>
          <strong>
            {throughput.rate > 0 ? throughput.rate.toFixed(1) : '—'}
            <small>文件/分钟</small>
          </strong>
          <em>近 5 分钟均值 · 失败 {throughput.failed}</em>
          <Sparkline data={dashboard?.throughput ?? []} />
        </div>
        <div className="ops-stat">
          <span>失败率</span>
          <strong>
            {failureRate}
            <small>%</small>
          </strong>
          <em>
            失败 {failedFilesCount} · 待审 {asNumber(coverage.reviewOpen)}
          </em>
        </div>
      </section>

      {pipeline.length > 0 ? (
        <section className="ops-panel ops-panel-pipeline" aria-label="分析流水线">
          <div className="ops-panel-head">
            <h2>分析流水线</h2>
            <span className="ops-panel-hint">点击阶段可在下方过滤文件</span>
          </div>
          <PipelineStrip
            stages={pipeline}
            selected={stageFilter}
            onSelect={(s) => {
              setStageFilter((prev) => (prev === s ? null : s));
              setTab('files');
            }}
          />
        </section>
      ) : null}

      <section className="ops-panel ops-panel-tabs">
        <div className="ops-tabbar" role="tablist">
          {(
            [
              { key: 'files', label: `文件明细 · ${dashboard?.activeItems.length ?? 0}` },
              { key: 'errors', label: `错误分组 · ${errorGroups.length}` },
              { key: 'coverage', label: '索引覆盖' },
              { key: 'events', label: `事件流 · ${allEvents.length}` },
            ] as Array<{ key: TabKey; label: string }>
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`ops-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ops-tab-body" role="tabpanel">
          {tab === 'files' ? (
            <FileTable
              items={dashboard?.activeItems ?? []}
              stageFilter={stageFilter}
              onClearStageFilter={() => setStageFilter(null)}
              busy={Boolean(busy)}
              onRetryItem={(itemId) =>
                runAction(
                  `retry-${itemId}`,
                  '重试此文件',
                  () => postJson('/api/sync/retry', { runId: run?.id, itemId }),
                  '已重新加入分析队列',
                )
              }
            />
          ) : null}

          {tab === 'errors' ? (
            <ErrorGroups
              groups={errorGroups}
              busy={Boolean(busy)}
              onRetryAll={() =>
                runAction('retry-all', '重试失败', () =>
                  postJson('/api/sync/retry', { runId: run?.id }),
                )
              }
              onRetryItem={(itemId) =>
                runAction(
                  `retry-${itemId}`,
                  '重试此文件',
                  () => postJson('/api/sync/retry', { runId: run?.id, itemId }),
                  '已重新加入分析队列',
                )
              }
            />
          ) : null}

          {tab === 'coverage' ? <CoverageBars coverage={coverage} /> : null}

          {tab === 'events' ? (
            <div className="ops-timeline">
              {visibleEvents.map((event) => (
                <article className="ops-event" key={event.id}>
                  <div className="ops-event-head">
                    <span className={`ops-badge tone-${badgeTone(event.level)}`}>
                      {STATUS_TEXT[event.level] || event.level}
                    </span>
                    {event.stage ? (
                      <span className="ops-badge tone-neutral">{event.stage}</span>
                    ) : null}
                    <span>{fmtDate(event.at)}</span>
                  </div>
                  {event.path ? <div className="ops-event-path">{event.path}</div> : null}
                  <p>{event.message}</p>
                </article>
              ))}
              {allEvents.length === 0 ? <p className="ops-empty">暂无事件。</p> : null}
              {hasMoreEvents ? (
                <button
                  type="button"
                  className="ops-events-toggle"
                  onClick={() => setEventsExpanded((v) => !v)}
                >
                  {eventsExpanded ? '收起' : `展开全部 (${allEvents.length})`}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function SyncDashboard() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}
