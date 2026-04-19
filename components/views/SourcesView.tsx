'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Icon, SourceTypeIcon } from '../Icons';

export function SourcesView() {
  const openSource = useAppStore((s) => s.openSource);
  const openModal = useAppStore((s) => s.openModal);

  const sources = useLiveQuery(
    async () => getDb().sources.orderBy('ingestedAt').reverse().toArray(),
    []
  );

  const conceptCountBySource = useLiveQuery(async () => {
    if (!sources) return new Map<string, number>();
    const db = getDb();
    const map = new Map<string, number>();
    await Promise.all(
      sources.map(async (s) => {
        const count = await db.concepts.where('sources').equals(s.id).count();
        map.set(s.id, count);
      })
    );
    return map;
  }, [sources]);

  if (!sources) return <div className="empty-state">加载中...</div>;

  return (
    <div className="view-padding">
      {sources.length === 0 ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="es-icon">
            <Icon.Sources />
          </div>
          <h3>还没有资料</h3>
          <p>添加文章、笔记或书籍节选。资料是不可变层,AI 只读不改。</p>
          <button className="modal-btn primary" style={{ maxWidth: 200, margin: '0 auto' }} onClick={openModal}>
            添加第一份资料
          </button>
        </div>
      ) : (
        sources.map((s) => (
          <button key={s.id} className="source-card" onClick={() => openSource(s.id)}>
            <div className="s-icon">
              <SourceTypeIcon type={s.type} />
            </div>
            <div className="s-body">
              <div className="s-title">{s.title}</div>
              <div className="s-meta">
                {s.author && <span>{s.author}</span>}
                <span className="pill">{conceptCountBySource?.get(s.id) ?? 0} 概念</span>
                <span className="pill">{formatRelativeTime(s.ingestedAt)}</span>
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
