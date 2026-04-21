'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Icon, SourceTypeIcon } from '../Icons';

const PAGE_SIZE = 50;

export function SourcesView() {
  const openSource = useAppStore((s) => s.openSource);
  const openModal = useAppStore((s) => s.openModal);
  const detail = useAppStore((s) => s.detail);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const sources = useLiveQuery(
    async () => getDb().sources.orderBy('ingestedAt').reverse().limit(visibleCount).toArray(),
    [visibleCount]
  );

  const totalSourceCount = useLiveQuery(async () => getDb().sources.count(), []);

  const conceptCountBySource = useLiveQuery(async () => {
    if (!sources) return new Map<string, number>();
    const db = getDb();
    const map = new Map<string, number>();
    await Promise.all(
      sources.map(async (source) => {
        const count = await db.concepts.where('sources').equals(source.id).count();
        map.set(source.id, count);
      })
    );
    return map;
  }, [sources]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, []);

  if (!sources) return <div className="empty-state">加载中...</div>;

  return (
    <div className="view-padding">
      <div className="view-lead">
        <div className="view-lead-kicker">资料档案</div>
        <p className="view-lead-copy">这里保留你喂给知识库的原始材料。原文不被改写，只被引用和编译。</p>
      </div>
      {(totalSourceCount ?? 0) === 0 ? (
        <div className="empty-state empty-state-compact">
          <div className="es-icon">
            <Icon.Sources />
          </div>
          <h3>还没有资料</h3>
          <p>添加文章、笔记或书籍节选。资料是不可变层,AI 只读不改。</p>
          <button className="modal-btn primary empty-state-action" onClick={openModal}>
            添加第一份资料
          </button>
        </div>
      ) : (
        <>
          {sources.map((source) => (
            <button
              key={source.id}
              className={`source-card${detail?.type === 'source' && detail.id === source.id ? ' active' : ''}`}
              onClick={() => openSource(source.id)}
            >
              <div className="s-icon">
                <SourceTypeIcon type={source.type} />
              </div>
              <div className="s-body">
                <div className="s-title">{source.title}</div>
                <div className="s-meta">
                  {source.author && <span>{source.author}</span>}
                  <span className="pill">{conceptCountBySource?.get(source.id) ?? 0} 概念</span>
                  <span className="pill">{formatRelativeTime(source.ingestedAt)}</span>
                </div>
              </div>
            </button>
          ))}
          <div className="list-end-hint">
            <span>已显示 {sources.length} / {totalSourceCount ?? sources.length} 份资料</span>
          </div>
          {sources.length < (totalSourceCount ?? 0) && (
            <button className="modal-btn" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              加载更多
            </button>
          )}
        </>
      )}
    </div>
  );
}
