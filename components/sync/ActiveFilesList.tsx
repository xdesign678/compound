'use client';

import { useMemo, useState } from 'react';
import { STAGE_TEXT, STATUS_TEXT, badgeTone, fmtDuration, type SyncItem } from './types';

interface Props {
  items: SyncItem[];
  busy: boolean;
  onRetryItem: (itemId: string) => void;
  onOpenAdvanced: () => void;
}

const PREVIEW_LIMIT = 8;

function durationOf(item: SyncItem): number | null {
  const start = item.started_at ?? null;
  if (start == null) return null;
  const end = item.finished_at ?? Date.now();
  return Math.max(0, end - start);
}

/**
 * Card list focused on the only files the user actually cares about right
 * now: running + failed. Everything else is one click away in the
 * advanced drawer.
 */
export default function ActiveFilesList({ items, busy, onRetryItem, onOpenAdvanced }: Props) {
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    return items
      .filter((it) => it.status === 'running' || it.status === 'failed')
      .sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === 'failed' ? -1 : 1;
        }
        return (durationOf(b) ?? 0) - (durationOf(a) ?? 0);
      });
  }, [items]);

  if (filtered.length === 0) {
    return (
      <section className="sync-v2-files sync-v2-files-empty" aria-label="活跃文件">
        <h2>没有正在处理或失败的文件</h2>
        <p>
          所有任务都已完成。需要查看历史可点
          <button type="button" className="sync-v2-link" onClick={onOpenAdvanced}>
            高级抽屉
          </button>
          查看完整文件表。
        </p>
      </section>
    );
  }

  const visible = showAll ? filtered : filtered.slice(0, PREVIEW_LIMIT);
  const hasMore = filtered.length > PREVIEW_LIMIT;

  return (
    <section className="sync-v2-files" aria-label="正在处理与失败的文件">
      <header className="sync-v2-section-head">
        <h2>正在处理与失败 · {filtered.length}</h2>
        <button type="button" className="sync-v2-link" onClick={onOpenAdvanced}>
          全部文件
        </button>
      </header>
      <ul className="sync-v2-file-list">
        {visible.map((item) => {
          const dur = durationOf(item);
          const stalled = item.status === 'running' && dur != null && dur > 5 * 60_000;
          const tone = item.status === 'failed' ? 'failed' : stalled ? 'stalled' : 'running';
          return (
            <li key={item.id} className={`sync-v2-file-card tone-${tone}`}>
              <div className="sync-v2-file-card-head">
                <span className="sync-v2-file-card-path" title={item.path}>
                  {item.path}
                </span>
                <span className={`sync-v2-badge tone-${badgeTone(item.status)}`}>
                  {STATUS_TEXT[item.status] || item.status}
                </span>
              </div>
              <div className="sync-v2-file-card-meta">
                <span>{STAGE_TEXT[item.stage] || item.stage}</span>
                <span aria-hidden="true">·</span>
                <span>{fmtDuration(dur)}</span>
                {stalled ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="sync-v2-file-card-stalled">已停滞</span>
                  </>
                ) : null}
              </div>
              {item.error ? (
                <p className="sync-v2-file-card-error" title={item.error}>
                  {item.error}
                </p>
              ) : null}
              {item.status === 'failed' || item.status === 'cancelled' ? (
                <div className="sync-v2-file-card-actions">
                  <button
                    type="button"
                    className="sync-v2-btn sync-v2-btn-tiny"
                    disabled={busy}
                    onClick={() => onRetryItem(item.id)}
                  >
                    重试此文件
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <button
          type="button"
          className="sync-v2-files-toggle"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? '收起' : `展开剩余 ${filtered.length - PREVIEW_LIMIT}`}
        </button>
      ) : null}
    </section>
  );
}
