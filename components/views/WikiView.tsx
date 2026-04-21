'use client';

import { useState, useMemo, useEffect, useDeferredValue } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';

interface WikiViewProps {
  scrollRootSelector?: string;
}

const PAGE_SIZE = 60;

export function WikiView({ scrollRootSelector = '.app-main' }: WikiViewProps) {
  const openConcept = useAppStore((s) => s.openConcept);
  const freshIds = useAppStore((s) => s.freshConceptIds);
  const detail = useAppStore((s) => s.detail);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [scrolled, setScrolled] = useState(false);

  const concepts = useLiveQuery(
    async () => {
      const q = deferredQuery.trim().toLowerCase();
      const collection = getDb().concepts.orderBy('updatedAt').reverse();
      if (!q) {
        return collection.limit(visibleCount).toArray();
      }
      return collection
        .filter((concept) => {
          return (
            concept.title.toLowerCase().includes(q) ||
            concept.summary.toLowerCase().includes(q)
          );
        })
        .limit(visibleCount)
        .toArray();
    },
    [deferredQuery, visibleCount]
  );

  const totalConceptCount = useLiveQuery(async () => {
    return getDb().concepts.count();
  }, []);

  const totalMatches = useLiveQuery(async () => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return getDb().concepts.count();
    return getDb()
      .concepts
      .orderBy('updatedAt')
      .reverse()
      .filter((concept) => {
        return (
          concept.title.toLowerCase().includes(q) ||
          concept.summary.toLowerCase().includes(q)
        );
      })
      .count();
  }, [deferredQuery]);

  const linkCount = useLiveQuery(async () => {
    const all = await getDb().concepts.toArray();
    return all.reduce((sum, concept) => sum + concept.related.length, 0);
  }, []);

  const sourceCount = useLiveQuery(async () => {
    return getDb().sources.count();
  }, []);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery]);

  useEffect(() => {
    const main = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 4);
    onScroll();
    main.addEventListener('scroll', onScroll);
    return () => main.removeEventListener('scroll', onScroll);
  }, [scrollRootSelector]);

  const fresh = useMemo(() => (concepts ?? []).filter((c) => freshIds[c.id]), [concepts, freshIds]);
  const others = useMemo(() => (concepts ?? []).filter((c) => !freshIds[c.id]), [concepts, freshIds]);

  if (!concepts) {
    return <div className="empty-state">加载中...</div>;
  }

  const renderCard = (c: (typeof concepts)[number]) => (
    <button
      key={c.id}
      className={`concept-card${freshIds[c.id] ? ' fresh' : ''}${detail?.type === 'concept' && detail.id === c.id ? ' active' : ''}`}
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

  const hasAnyConcepts = (totalConceptCount ?? 0) > 0;
  const hasMatches = (totalMatches ?? concepts.length) > 0;

  return (
    <>
      <div className={`search-bar ${scrolled ? 'scrolled' : ''}`}>
        <div className="search-label">检索概念、摘要与引用</div>
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
      <div className="view-lead">
        <div className="view-lead-kicker">知识 Wiki</div>
        <p className="view-lead-copy">由资料逐步编译出的概念网络，适合回看、串联和继续提问。</p>
      </div>
      <div className="stats-row">
        <div className="stat">
          <strong>{totalConceptCount ?? concepts.length}</strong> 概念
        </div>
        <span className="dot-sep">·</span>
        <div className="stat">
          <strong>{linkCount ?? 0}</strong> 引用
        </div>
        <span className="dot-sep">·</span>
        <div className="stat">
          <strong>{sourceCount ?? 0}</strong> 资料
        </div>
      </div>

      {!hasMatches ? (
        !hasAnyConcepts ? (
          <div className="empty-state empty-state-spacious">
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
            <span>
              已显示 {concepts.length} / {totalMatches ?? concepts.length} 个概念 · 点击 + 添加更多知识
            </span>
          </div>
          {concepts.length < (totalMatches ?? 0) && (
            <button className="modal-btn" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              加载更多
            </button>
          )}
        </>
      )}
    </>
  );
}
