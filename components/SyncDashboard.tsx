'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAdminAuthHeaders } from '@/lib/admin-auth-client';

type SyncRun = {
  id: string;
  status: string;
  stage: string;
  repo: string | null;
  branch: string | null;
  changed_files: number;
  created_files: number;
  updated_files: number;
  deleted_files: number;
  skipped_files: number;
  done_files: number;
  failed_files: number;
  current: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
};

type SyncItem = {
  id: string;
  path: string;
  change_type: string;
  status: string;
  stage: string;
  chunks: number | null;
  concepts_created: number | null;
  concepts_updated: number | null;
  evidence: number | null;
  error: string | null;
};

type SyncEvent = {
  id: string;
  at: number;
  level: string;
  stage: string | null;
  path: string | null;
  message: string;
};

type Dashboard = {
  activeRun: SyncRun | null;
  latestRuns: SyncRun[];
  activeItems: SyncItem[];
  events: SyncEvent[];
  coverage: Record<string, number | string | boolean>;
  analysisStats: Array<{ stage: string; status: string; count: number }>;
  errorStats: Array<{ error: string; count: number; lastAt: number }>;
};

const statusText: Record<string, string> = {
  queued: '排队',
  running: '运行中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
  succeeded: '成功',
  skipped: '跳过',
};

const stageText: Record<string, string> = {
  scan: '扫描',
  diff: '比对',
  download: '下载',
  ingest: '入库',
  llm: '分析',
  chunk: '分块',
  fts: '全文',
  embedding: '向量',
  summarize: '摘要',
  qa_index: '问答索引',
  delete: '删除',
  complete: '完成',
};

function fmtDate(value?: number | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function progress(done: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
}

function badgeTone(value: string) {
  if (['done', 'succeeded', 'success'].includes(value)) return 'good';
  if (['failed', 'cancelled', 'error'].includes(value)) return 'bad';
  if (['running', 'queued', 'warn'].includes(value)) return 'warn';
  return 'neutral';
}

function Badge({ value }: { value: string }) {
  return <span className={`ops-badge tone-${badgeTone(value)}`}>{statusText[value] || stageText[value] || value}</span>;
}

async function postJson(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...getAdminAuthHeaders(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export default function SyncDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/dashboard', {
        headers: getAdminAuthHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setDashboard((await res.json()) as Dashboard);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const runAction = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy('');
      }
    },
    [load]
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  const run = dashboard?.activeRun ?? dashboard?.latestRuns?.[0] ?? null;
  const coverage = dashboard?.coverage ?? {};
  const doneCount = (run?.done_files ?? 0) + (run?.failed_files ?? 0);
  const percent = run ? progress(doneCount, run.changed_files) : 0;
  const analysisRows = useMemo(() => dashboard?.analysisStats ?? [], [dashboard]);

  return (
    <main className="ops-page">
      <header className="ops-topbar">
        <div>
          <div className="ops-kicker">Compound Ops</div>
          <h1>同步控制台</h1>
          <p>{run?.current || run?.error || '同步、分析、向量索引和人工审核的实时状态。'}</p>
        </div>
        <div className="ops-actions">
          <button
            className="ops-btn primary"
            disabled={Boolean(busy)}
            onClick={() => runAction('sync', () => postJson('/api/sync/github/run'))}
          >
            {busy === 'sync' ? '启动中' : '立即同步'}
          </button>
          <button
            className="ops-btn"
            disabled={Boolean(busy)}
            onClick={() => runAction('worker', () => postJson('/api/sync/worker'))}
          >
            跑分析
          </button>
          <button
            className="ops-btn"
            disabled={Boolean(busy)}
            onClick={() => runAction('retry', () => postJson('/api/sync/retry', { runId: run?.id }))}
          >
            重试失败
          </button>
          <button
            className="ops-btn danger"
            disabled={Boolean(busy)}
            onClick={() => runAction('cancel', () => postJson('/api/sync/cancel'))}
          >
            取消
          </button>
          <Link className="ops-btn" href="/review">审核队列</Link>
          <Link className="ops-btn subtle" href="/">返回知识库</Link>
        </div>
      </header>

      {error ? <div className="ops-alert">{error}</div> : null}

      <section className="ops-stat-grid" aria-label="同步概览">
        <div className="ops-stat">
          <span>当前状态</span>
          <strong>{run ? statusText[run.status] || run.status : '空闲'}</strong>
          <em>{run?.repo ? `${run.repo}@${run.branch || 'main'}` : '暂无任务'}</em>
        </div>
        <div className="ops-stat">
          <span>同步进度</span>
          <strong>{percent}%</strong>
          <em>完成 {run?.done_files ?? 0} / 变更 {run?.changed_files ?? 0}</em>
        </div>
        <div className="ops-stat">
          <span>分析队列</span>
          <strong>{asNumber(coverage.analysisQueued)}</strong>
          <em>失败 {asNumber(coverage.analysisFailed)} · 向量 {asNumber(coverage.chunkEmbeddings)}</em>
        </div>
        <div className="ops-stat">
          <span>人工审核</span>
          <strong>{asNumber(coverage.reviewOpen)}</strong>
          <em>已处理 {asNumber(coverage.reviewResolved)}</em>
        </div>
      </section>

      {run ? (
        <section className="ops-panel">
          <div className="ops-panel-head">
            <div>
              <h2>最近任务</h2>
              <div className="ops-badge-row">
                <Badge value={run.status} />
                <Badge value={run.stage} />
              </div>
            </div>
            <div className="ops-time">
              <span>开始 {fmtDate(run.started_at)}</span>
              <span>结束 {fmtDate(run.finished_at)}</span>
            </div>
          </div>
          <div className="ops-progress" aria-label={`同步进度 ${percent}%`}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="ops-run-meta">
            新增 {run.created_files} · 更新 {run.updated_files} · 删除 {run.deleted_files} · 跳过 {run.skipped_files} · 失败 {run.failed_files}
          </div>
        </section>
      ) : null}

      <section className="ops-grid-3">
        <div className="ops-panel">
          <h2>索引覆盖</h2>
          <div className="ops-metric-grid">
            {[
              ['GitHub 文档', coverage.githubSources],
              ['活跃文件', coverage.activeSourceFiles],
              ['原文分块', coverage.sourceChunks],
              ['全文索引', coverage.chunkFtsRows],
              ['向量索引', coverage.chunkEmbeddings],
              ['证据链', coverage.conceptEvidence],
              ['模型调用', coverage.modelRuns],
              ['FTS', coverage.ftsReady ? 'ready' : 'off'],
            ].map(([label, value]) => (
              <div className="ops-metric" key={String(label)}>
                <span>{String(label)}</span>
                <strong>{String(value ?? 0)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="ops-panel">
          <h2>分析阶段</h2>
          <div className="ops-stack">
            {analysisRows.map((row) => (
              <div className="ops-row" key={`${row.stage}-${row.status}`}>
                <span>{stageText[row.stage] || row.stage}</span>
                <span>
                  <Badge value={row.status} />
                  <strong>{row.count}</strong>
                </span>
              </div>
            ))}
            {analysisRows.length === 0 ? <p className="ops-empty">暂无分析任务。</p> : null}
          </div>
        </div>

        <div className="ops-panel">
          <h2>错误中心</h2>
          <div className="ops-stack scroll">
            {(dashboard?.errorStats ?? []).map((item) => (
              <div className="ops-error" key={`${item.error}-${item.lastAt}`}>
                <div>
                  <strong>{item.count} 个文件</strong>
                  <span>{fmtDate(item.lastAt)}</span>
                </div>
                <p>{item.error}</p>
              </div>
            ))}
            {(dashboard?.errorStats ?? []).length === 0 ? <p className="ops-empty">暂无错误。</p> : null}
          </div>
        </div>
      </section>

      <section className="ops-panel">
        <h2>文件明细</h2>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>路径</th>
                <th>变更</th>
                <th>状态</th>
                <th>阶段</th>
                <th>分块</th>
                <th>概念</th>
                <th>证据</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard?.activeItems ?? []).map((item) => (
                <tr key={item.id}>
                  <td title={item.path}>{item.path}</td>
                  <td>{item.change_type}</td>
                  <td><Badge value={item.status} /></td>
                  <td>{stageText[item.stage] || item.stage}</td>
                  <td>{item.chunks ?? '-'}</td>
                  <td>{(item.concepts_created ?? 0) + (item.concepts_updated ?? 0) || '-'}</td>
                  <td>{item.evidence ?? '-'}</td>
                  <td title={item.error || ''}>{item.error || '-'}</td>
                </tr>
              ))}
              {(dashboard?.activeItems ?? []).length === 0 ? (
                <tr>
                  <td colSpan={8}>暂无文件任务。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ops-panel">
        <h2>事件时间线</h2>
        <div className="ops-timeline">
          {(dashboard?.events ?? []).map((event) => (
            <article className="ops-event" key={event.id}>
              <div className="ops-event-head">
                <Badge value={event.level} />
                {event.stage ? <Badge value={event.stage} /> : null}
                <span>{fmtDate(event.at)}</span>
              </div>
              {event.path ? <div className="ops-event-path">{event.path}</div> : null}
              <p>{event.message}</p>
            </article>
          ))}
          {(dashboard?.events ?? []).length === 0 ? <p className="ops-empty">暂无事件。</p> : null}
        </div>
      </section>
    </main>
  );
}
