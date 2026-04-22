'use client';

import Dexie from 'dexie';
import DOMPurify from 'dompurify';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { formatRelativeTime, groupActivityByDate } from '@/lib/format';
import { useAppStore, type ActivityFilterType } from '@/lib/store';
import type { ActivityLog } from '@/lib/types';
import { Icon } from '../Icons';

const FILTERS: { key: ActivityFilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ingest', label: '摄入' },
  { key: 'query', label: '问答' },
  { key: 'lint', label: '检查' },
];

export function ActivityLogView() {
  const filter = useAppStore((s) => s.activityFilter);
  const setFilter = useAppStore((s) => s.setActivityFilter);

  const items = useLiveQuery(
    async () => {
      const db = getDb();
      if (filter === 'all') {
        return db.activity.orderBy('at').reverse().toArray();
      }
      return db.activity
        .where('[type+at]')
        .between([filter, Dexie.minKey], [filter, Dexie.maxKey])
        .reverse()
        .toArray();
    },
    [filter]
  );

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
      <div className="activity-filter-bar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-chip${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!items ? (
        <div className="empty-state">加载中...</div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 40 }}>
          <div className="es-icon"><Icon.Activity /></div>
          <h3>暂无活动记录</h3>
          <p>当你添加资料、提问、或运行健康检查时,AI 的动作会记录在这里。</p>
        </div>
      ) : (
        <div className="activity-list">
          {groupActivityByDate(items).map((g) => (
            <div key={g.label}>
              <div className="activity-date-header">{g.label}</div>
              {g.items.map((it) => (
                <div
                  key={it.id}
                  className={`activity-item type-${it.type}${it.status ? ` status-${it.status}` : ''}`}
                >
                  <div className="a-icon">{iconFor(it)}</div>
                  <div className="a-body">
                    <div
                      className="a-title"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          it.title
                            .replace(/<em>/g, '<span class="emphasis">')
                            .replace(/<\/em>/g, '</span>')
                        ),
                      }}
                    />
                    <div className="a-details">{it.details}</div>
                    <div className="a-time">{formatRelativeTime(it.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
