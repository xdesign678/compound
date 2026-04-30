'use client';

import {
  useEffect,
  useState,
  useDeferredValue,
  useMemo,
  useCallback,
  useRef,
  useLayoutEffect,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Icon, SourceTypeIcon } from '../Icons';
import type { SourceType } from '@/lib/types';

const PAGE_SIZE = 50;
const SCROLL_ROOT_SELECTOR = '.app-main';

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  link: '链接',
  text: '文本',
  file: '文件',
  article: '文章',
  book: '书籍',
  pdf: 'PDF',
  gist: '代码片段',
};

export function SourcesView() {
  const openSource = useAppStore((s) => s.openSource);
  const openModal = useAppStore((s) => s.openModal);
  const detail = useAppStore((s) => s.detail);
  const setSearchCollapsed = useAppStore((s) => s.setSearchCollapsed);
  const searchFocusNonce = useAppStore((s) => s.searchFocusNonce);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const query = useAppStore((s) => s.sourcesState.query);
  const visibleCount = useAppStore((s) => s.sourcesState.visibleCount);
  const setSourcesState = useAppStore((s) => s.setSourcesState);

  const setQuery = useCallback((v: string) => setSourcesState({ query: v }), [setSourcesState]);
  const setVisibleCount = useCallback(
    (updater: number | ((count: number) => number)) => {
      const current = useAppStore.getState().sourcesState.visibleCount;
      const next = typeof updater === 'function' ? updater(current) : updater;
      setSourcesState({ visibleCount: next });
    },
    [setSourcesState],
  );

  const deferredQuery = useDeferredValue(query);
  const [scrolled, setScrolled] = useState(false);
  // Keep the user's current page size on first mount; only reset after they change the filter.
  const filterResetSkipRef = useRef(true);
  const scrollRestoredRef = useRef(false);

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

  const normalizedQuery = deferredQuery.trim().toLowerCase();

  const matchingSources = useMemo(() => {
    if (!sources) return [];
    return sources.filter(
      (source) =>
        source.title.toLowerCase().includes(normalizedQuery) ||
        (source.author ?? '').toLowerCase().includes(normalizedQuery),
    );
  }, [normalizedQuery, sources]);

  const filteredSources = useMemo(
    () => matchingSources.slice(0, visibleCount),
    [matchingSources, visibleCount],
  );

  const totalMatches = matchingSources.length;

  useEffect(() => {
    if (filterResetSkipRef.current) {
      filterResetSkipRef.current = false;
      return;
    }
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery, setVisibleCount]);

  useEffect(() => {
    const main = document.querySelector(SCROLL_ROOT_SELECTOR) as HTMLElement | null;
    if (!main) return;
    let raf = 0;
    let pendingY: number | null = null;
    const flush = () => {
      raf = 0;
      if (pendingY !== null) {
        useAppStore.getState().setSourcesState({ scrollTop: pendingY });
        pendingY = null;
      }
    };
    const onScroll = () => {
      const y = main.scrollTop;
      setScrolled(y > 4);
      setSearchCollapsed(y > 40);
      pendingY = y;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', onScroll);
      setSearchCollapsed(false);
      if (raf) cancelAnimationFrame(raf);
      if (pendingY !== null) {
        useAppStore.getState().setSourcesState({ scrollTop: pendingY });
      }
    };
  }, [setSearchCollapsed]);

  // Restore the list scroll only once after Dexie has finished hydrating the source list.
  useLayoutEffect(() => {
    if (scrollRestoredRef.current) return;
    if (!sources) return;
    const main = document.querySelector(SCROLL_ROOT_SELECTOR) as HTMLElement | null;
    if (!main) return;
    scrollRestoredRef.current = true;
    const saved = useAppStore.getState().sourcesState.scrollTop;
    if (saved > 0) {
      main.scrollTop = saved;
    }
  }, [sources]);

  useEffect(() => {
    if (searchFocusNonce === 0) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 240);
    return () => window.clearTimeout(id);
  }, [searchFocusNonce]);

  if (!sources) return <div className="empty-state">加载中...</div>;

  return (
    <>
      <div className={`search-bar-slot${scrolled ? ' is-collapsed' : ''}`}>
        <div className={`search-bar ${scrolled ? 'scrolled' : ''}`}>
          <div className="search-label">按标题或作者搜索资料</div>
          <div className="search-wrap">
            <Icon.Search />
            <input
              ref={searchInputRef}
              className="search-input"
              placeholder="搜索标题、作者..."
              aria-label="搜索资料"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
                <div className="s-title">{source.title}</div>
                {source.author && <div className="s-author">{source.author}</div>}
                <div className="s-meta">
                  <span className="s-type-badge">
                    <SourceTypeIcon type={source.type} />
                    {SOURCE_TYPE_LABELS[source.type]}
                  </span>
                  <span>·</span>
                  <span>{conceptCountBySource?.get(source.id) ?? 0} 个概念</span>
                  <span>·</span>
                  <span>{formatRelativeTime(source.ingestedAt)}</span>
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
