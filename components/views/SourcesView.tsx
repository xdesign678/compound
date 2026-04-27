'use client';

import { useEffect, useState, useDeferredValue, useMemo } from 'react';
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
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [scrolled, setScrolled] = useState(false);

  const sources = useLiveQuery(
    async () => getDb().sources.orderBy('ingestedAt').reverse().toArray(),
    [],
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
      }),
    );
    return map;
  }, [sources]);

  const filteredSources = useMemo(() => {
    if (!sources) return [];
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return sources.slice(0, visibleCount);
    return sources
      .filter(
        (source) =>
          source.title.toLowerCase().includes(q) || (source.author ?? '').toLowerCase().includes(q),
      )
      .slice(0, visibleCount);
  }, [sources, deferredQuery, visibleCount]);

  const totalMatches = useMemo(() => {
    if (!sources) return 0;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return sources.length;
    return sources.filter(
      (source) =>
        source.title.toLowerCase().includes(q) || (source.author ?? '').toLowerCase().includes(q),
    ).length;
  }, [sources, deferredQuery]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery]);

  useEffect(() => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 4);
    onScroll();
    main.addEventListener('scroll', onScroll);
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  if (!sources) return <div className="empty-state">加载中...</div>;

  return (
    <>
      <div className={`search-bar ${scrolled ? 'scrolled' : ''}`}>
        <div className="search-label">按标题或作者搜索资料</div>
        <div className="search-wrap">
          <Icon.Search />
          <input
            className="search-input"
            placeholder="搜索标题、作者..."
            aria-label="搜索资料"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="view-padding">
        <div className="view-lead">
          <div className="view-lead-kicker">资料档案</div>
          <p className="view-lead-copy">
            这里保留你喂给知识库的原始材料。原文不被改写，只被引用和编译。
          </p>
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
        ) : filteredSources.length === 0 ? (
          <div className="empty-state empty-state-compact search-empty-state">
            <div className="es-icon">
              <Icon.Search />
            </div>
            <h3>没有找到资料</h3>
            <p>换个关键词试试，或清空搜索回到全部资料。</p>
            <button className="modal-btn empty-state-action" onClick={() => setQuery('')}>
              清空搜索
            </button>
          </div>
        ) : (
          <>
            {filteredSources.map((source) => (
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
              <span>
                已显示 {filteredSources.length} / {totalMatches} 份资料
              </span>
            </div>
            {filteredSources.length < totalMatches && (
              <button
                className="modal-btn"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                加载更多
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
