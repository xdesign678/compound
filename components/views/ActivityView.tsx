'use client';

import DOMPurify from 'dompurify';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { formatRelativeTime, groupActivityByDate } from '@/lib/format';
import { Icon } from '../Icons';

export function ActivityView() {
  const items = useLiveQuery(
    async () => getDb().activity.orderBy('at').reverse().toArray(),
    []
  );

  if (!items) return <div className="empty-state">加载中...</div>;
  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 60 }}>
        <div className="es-icon">
          <Icon.Activity />
        </div>
        <h3>暂无活动记录</h3>
        <p>当你添加资料、提问、或运行健康检查时,AI 的动作会记录在这里。</p>
      </div>
    );
  }

  const groups = groupActivityByDate(items);
  const iconFor = (type: string) => {
    if (type === 'ingest') return <Icon.Ingest />;
    if (type === 'query') return <Icon.Query />;
    return <Icon.Lint />;
  };

  return (
    <div className="activity-list">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="activity-date-header">{g.label}</div>
          {g.items.map((it) => (
            <div key={it.id} className={`activity-item type-${it.type}`}>
              <div className="a-icon">{iconFor(it.type)}</div>
              <div className="a-body">
                <div className="a-title" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(it.title.replace(/<em>/g, '<span class="emphasis">').replace(/<\/em>/g, '</span>')) }} />
                <div className="a-details">{it.details}</div>
                <div className="a-time">{formatRelativeTime(it.at)}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
