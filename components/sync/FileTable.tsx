'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  STAGE_TEXT,
  STATUS_TEXT,
  badgeTone,
  fmtDuration,
  type SyncItem,
  type SyncItemStatus,
} from './types';

interface Props {
  items: SyncItem[];
  /** Optional pre-filter coming from the pipeline strip click. */
  stageFilter: string | null;
  onClearStageFilter: () => void;
  onRetryItem: (itemId: string) => void;
  busy?: boolean;
}

const FILTERS: Array<{ key: 'all' | SyncItemStatus; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'failed', label: '失败' },
  { key: 'queued', label: '排队' },
  { key: 'succeeded', label: '成功' },
  { key: 'skipped', label: '跳过' },
  { key: 'cancelled', label: '已取消' },
];

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  failed: 1,
  queued: 2,
  succeeded: 3,
  skipped: 4,
  cancelled: 5,
};

function durationOf(item: SyncItem): number | null {
  const start = item.started_at ?? null;
  if (start == null) return null;
  const end = item.finished_at ?? Date.now();
  return Math.max(0, end - start);
}

function rowTone(item: SyncItem): string {
  if (item.status === 'failed') return 'failed';
  if (item.status === 'running') {
    const dur = durationOf(item);
    if (dur != null && dur > 5 * 60_000) return 'stalled';
    if (dur != null && dur > 90_000) return 'slow';
    return 'running';
  }
  if (item.status === 'succeeded') return 'succeeded';
  return 'neutral';
}

export default function FileTable({
  items,
  stageFilter,
  onClearStageFilter,
  onRetryItem,
  busy,
}: Props) {
  const [activeStatus, setActiveStatus] = useState<'all' | SyncItemStatus>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => activeStatus === 'all' || it.status === activeStatus)
      .filter((it) => !stageFilter || it.stage === stageFilter || it.stage === 'llm')
      .filter((it) => !q || it.path.toLowerCase().includes(q))
      .sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 9;
        const sb = STATUS_ORDER[b.status] ?? 9;
        if (sa !== sb) return sa - sb;
        const da = durationOf(a) ?? 0;
        const db = durationOf(b) ?? 0;
        return db - da;
      });
  }, [items, activeStatus, stageFilter, query]);

  return (
    <div className="ops-file-panel">
      <div className="ops-file-toolbar">
        <div className="ops-file-chips">
          {FILTERS.map((f) => {
            const count = counts[f.key] ?? 0;
            const isActive = activeStatus === f.key;
            return (
              <button
                key={f.key}
                type="button"
                className={`ops-chip${isActive ? ' active' : ''}`}
                onClick={() => setActiveStatus(f.key)}
              >
                {f.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="ops-file-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按路径过滤…"
            aria-label="按路径过滤文件"
          />
          {stageFilter ? (
            <button
              type="button"
              className="ops-chip active"
              onClick={onClearStageFilter}
              title="点击清除阶段过滤"
            >
              阶段：{STAGE_TEXT[stageFilter] || stageFilter}
              <span>×</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="ops-table-wrap ops-table-desktop">
        <table className="ops-table ops-file-table">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>路径</th>
              <th>变更</th>
              <th>状态</th>
              <th>阶段</th>
              <th>耗时</th>
              <th>分块</th>
              <th>概念</th>
              <th>错误</th>
              <th aria-label="操作"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const dur = durationOf(item);
              const tone = rowTone(item);
              const isOpen = expanded[item.id];
              return (
                <Fragment key={item.id}>
                  <tr className={`ops-file-row tone-${tone}`}>
                    <td title={item.path}>
                      <button
                        type="button"
                        className="ops-file-path"
                        onClick={() => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))}
                        aria-expanded={isOpen}
                      >
                        <span className="ops-file-disclosure">{isOpen ? '▾' : '▸'}</span>
                        {item.path}
                      </button>
                    </td>
                    <td>{item.change_type}</td>
                    <td>
                      <span className={`ops-badge tone-${badgeTone(item.status)}`}>
                        {STATUS_TEXT[item.status] || item.status}
                      </span>
                    </td>
                    <td>{STAGE_TEXT[item.stage] || item.stage}</td>
                    <td className={tone === 'stalled' ? 'ops-cell-stalled' : ''}>
                      {fmtDuration(dur)}
                      {tone === 'stalled' ? <small>已停滞</small> : null}
                    </td>
                    <td>{item.chunks ?? '-'}</td>
                    <td>{(item.concepts_created ?? 0) + (item.concepts_updated ?? 0) || '-'}</td>
                    <td title={item.error || ''} className="ops-file-error-cell">
                      {item.error ? (
                        <span className="ops-file-error" title={item.error}>
                          {item.error.slice(0, 60)}
                          {item.error.length > 60 ? '…' : ''}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      {item.status === 'failed' || item.status === 'cancelled' ? (
                        <button
                          type="button"
                          className="ops-btn ops-btn-tiny"
                          disabled={busy}
                          onClick={() => onRetryItem(item.id)}
                        >
                          重试
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="ops-file-detail-row">
                      <td colSpan={9}>
                        <dl className="ops-file-detail">
                          <div>
                            <dt>itemId</dt>
                            <dd>{item.id}</dd>
                          </div>
                          {item.attempts != null ? (
                            <div>
                              <dt>重试次数</dt>
                              <dd>{item.attempts}</dd>
                            </div>
                          ) : null}
                          {item.error ? (
                            <div>
                              <dt>错误全文</dt>
                              <dd>{item.error}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>开始时间</dt>
                            <dd>
                              {item.started_at ? new Date(item.started_at).toLocaleString() : '-'}
                            </dd>
                          </div>
                          <div>
                            <dt>更新时间</dt>
                            <dd>
                              {item.updated_at ? new Date(item.updated_at).toLocaleString() : '-'}
                            </dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="ops-empty">
                  当前过滤条件下没有文件。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="ops-table-mobile">
        {filtered.map((item) => {
          const dur = durationOf(item);
          const tone = rowTone(item);
          return (
            <div key={item.id} className={`ops-mobile-card tone-${tone}`}>
              <div className="ops-mobile-card-header">
                <span className="ops-mobile-card-path" title={item.path}>
                  {item.path}
                </span>
                <span className={`ops-badge tone-${badgeTone(item.status)}`}>
                  {STATUS_TEXT[item.status] || item.status}
                </span>
              </div>
              <div className="ops-mobile-card-meta">
                <span>{item.change_type}</span>
                <span>·</span>
                <span>{STAGE_TEXT[item.stage] || item.stage}</span>
                <span>·</span>
                <span>{fmtDuration(dur)}</span>
              </div>
              {item.error ? <div className="ops-mobile-card-error">{item.error}</div> : null}
              {item.status === 'failed' || item.status === 'cancelled' ? (
                <button
                  type="button"
                  className="ops-btn ops-btn-tiny"
                  disabled={busy}
                  onClick={() => onRetryItem(item.id)}
                >
                  重试此文件
                </button>
              ) : null}
            </div>
          );
        })}
        {filtered.length === 0 ? <p className="ops-empty">当前过滤条件下没有文件。</p> : null}
      </div>
    </div>
  );
}
