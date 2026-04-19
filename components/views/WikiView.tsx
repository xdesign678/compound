'use client';

import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';

export function WikiView() {
  const openConcept = useAppStore((s) => s.openConcept);
  const freshIds = useAppStore((s) => s.freshConceptIds);

  const concepts = useLiveQuery(
    async () => getDb().concepts.orderBy('updatedAt').reverse().toArray(),
    []
  );

  const sourceCount = useLiveQuery(async () => {
    return getDb().sources.count();
  }, []);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 4);
    main.addEventListener('scroll', onScroll);
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  const filtered = useMemo(() => {
    if (!concepts) return [];
    if (!deferredQuery.trim()) return concepts;
    const q = deferredQuery.toLowerCase();
    return concepts.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.summary.toLowerCase().includes(q)
    );
  }, [concepts, deferredQuery]);

  const fresh = useMemo(() => filtered.filter((c) => freshIds[c.id]), [filtered, freshIds]);
  const others = useMemo(() => filtered.filter((c) => !freshIds[c.id]), [filtered, freshIds]);

  if (!concepts) {
    return <div className="empty-state">加载中...</div>;
  }

  const linkCount = concepts.reduce((sum, c) => sum + c.related.length, 0);

  const renderCard = (c: (typeof concepts)[number]) => (
    <button
      key={c.id}
      className={`concept-card ${freshIds[c.id] ? 'fresh' : ''}`}
      onClick={() => openConcept(c.id)}
    >
      <div className="title">{c.title}</div>
      <div className="summary">{c.summary}</div>
      <div className="meta">
        <span className="badge-link">
          <Icon.Link />
          {c.related.length} 链接
        </span>
        <span>·</span>
        <span>来自 {c.sources.length} 份资料</span>
        <span>·</span>
        <span className={freshIds[c.id] ? 'updated' : ''}>{formatRelativeTime(c.updatedAt)}</span>
      </div>
    </button>
  );

  return (
    <>
      <div className={`search-bar ${scrolled ? 'scrolled' : ''}`}>
        <div className="search-wrap">
          <Icon.Search />
          <input
            className="search-input"
            placeholder="搜索概念、资料、引用..."
            aria-label="搜索概念"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="stats-row">
        <div className="stat">
          <strong>{concepts.length}</strong> 概念
        </div>
        <span className="dot-sep">·</span>
        <div className="stat">
          <strong>{linkCount}</strong> 引用
        </div>
        <span className="dot-sep">·</span>
        <div className="stat">
          <strong>{sourceCount ?? 0}</strong> 资料
        </div>
      </div>

      {filtered.length === 0 ? (
        concepts.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <div className="es-icon">
              <Icon.Sparkle />
            </div>
            <h3>Wiki 还是空的</h3>
            <p>点击右下角 <strong>+</strong> 添加第一份资料,AI 会把它编译成你的第一批概念页。</p>
          </div>
        ) : (
          <div className="empty-state">没有匹配的概念</div>
        )
      ) : (
        <>
          {fresh.length > 0 && (
            <>
              <div className="section-heading">刚更新</div>
              <div className="concept-list">{fresh.map(renderCard)}</div>
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="section-heading">全部概念</div>
              <div className="concept-list">{others.map(renderCard)}</div>
            </>
          )}
          <div className="list-end-hint">
            <span>{filtered.length} 个概念 · 点击 + 添加更多知识</span>
          </div>
        </>
      )}
    </>
  );
}
