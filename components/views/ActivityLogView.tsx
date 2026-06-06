'use client';

import { useId, useState } from 'react';
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { formatRelativeTime, groupActivityByDate, escapeHTML } from '@/lib/format';
import { useAppStore, type ActivityFilterType } from '@/lib/store';
import type { ActivityLog } from '@/lib/types';
import { Icon } from '../Icons';

const FILTERS: { key: ActivityFilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ingest', label: '摄入' },
  { key: 'query', label: '问答' },
  { key: 'lint', label: '检查' },
];

const PAGE_SIZE = 100;

export function ActivityLogView() {
  const listBaseId = useId();
  const filter = useAppStore((s) => s.activityFilter);
  const setFilter = useAppStore((s) => s.setActivityFilter);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const items = useLiveQuery(async () => {
    const db = getDb();
    if (filter === 'all') {
      return db.activity.orderBy('at').reverse().limit(visibleCount).toArray();
    }
    return db.activity
      .where('[type+at]')
      .between([filter, Dexie.minKey], [filter, Dexie.maxKey])
      .reverse()
      .limit(visibleCount)
      .toArray();
  }, [filter, visibleCount]);

  const totalCount = useLiveQuery(async () => {
    const db = getDb();
    if (filter === 'all') {
      return db.activity.count();
    }
    return db.activity
      .where('[type+at]')
      .between([filter, Dexie.minKey], [filter, Dexie.maxKey])
      .count();
  }, [filter]);

  // Reset pagination when filter changes
  const handleSetFilter = (f: ActivityFilterType) => {
    setVisibleCount(PAGE_SIZE);
    setFilter(f);
  };

  const iconFor = (item: ActivityLog) => {
    if (item.type === 'lint' && item.status === 'running') {
      return <span className="lint-spinner activity-spinner" />;
    }
    if (item.type === 'lint' && item.status === 'error') {
      return <Icon.Contradiction />;
    }
    if (item.type === 'ingest') return <Icon.Ingest />;
    if (item.type === 'query') return <Icon.Query />;
    return <Icon.Lint />;
  };

  return (
    <div className="activity-log-view">
      <div className="activity-filter-bar" role="toolbar" aria-label="活动类型筛选">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`filter-chip${filter === f.key ? ' active' : ''}`}
            onClick={() => handleSetFilter(f.key)}
            aria-pressed={filter === f.key}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!items ? (
        <div className="empty-state" role="status" aria-live="polite" aria-busy="true">
          加载中...
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 40 }} role="status" aria-live="polite">
          <div className="es-icon" aria-hidden="true">
            <Icon.Activity />
          </div>
          <h3>暂无活动记录</h3>
          <p>当你添加资料、提问、或运行健康检查时，AI 的动作会记录在这里。</p>
        </div>
      ) : (
        <section className="activity-list" aria-label="活动时间线">
          {groupActivityByDate(items).map((g, groupIndex) => {
            const groupLabelId = `${listBaseId}-date-${groupIndex}`;
            return (
              <section key={g.label} aria-labelledby={groupLabelId}>
                <div id={groupLabelId} className="activity-date-header">
                  {g.label}
                </div>
                {g.items.map((it) => {
                  const itemTitleId = `${listBaseId}-item-${it.id}`;
                  return (
                    <div
                      key={it.id}
                      role="article"
                      aria-labelledby={itemTitleId}
                      className={`activity-item type-${it.type}${it.status ? ` status-${it.status}` : ''}`}
                    >
                      <div className="a-icon" aria-hidden="true">
                        {iconFor(it)}
                      </div>
                      <div className="a-body">
                        <div
                          id={itemTitleId}
                          className="a-title"
                          dangerouslySetInnerHTML={{
                            __html: escapeHTML(it.title)
                              .replace(/&lt;em&gt;/g, '<span class="emphasis">')
                              .replace(/&lt;\/em&gt;/g, '</span>'),
                          }}
                        />
                        <div className="a-details">{it.details}</div>
                        <time className="a-time" dateTime={new Date(it.at).toISOString()}>
                          {formatRelativeTime(it.at)}
                        </time>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {items.length < (totalCount ?? 0) && (
            <button
              type="button"
              className="modal-btn"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              aria-label={`加载更多活动，当前已显示 ${items.length} 条，共 ${totalCount ?? items.length} 条`}
            >
              加载更多（已显示 {items.length} / {totalCount ?? items.length}）
            </button>
          )}
        </section>
      )}
    </div>
  );
}
