'use client';

import './sources.css';
import { useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { Icon, SourceTypeIcon } from '../Icons';
import { OnboardingCard } from '../OnboardingCard';
import { useScrollSpy } from '@/lib/hooks/useScrollSpy';
import { SOURCE_TYPE_LABELS } from '@/lib/constants';

const PAGE_SIZE = 50;
const SCROLL_ROOT_SELECTOR = '.app-main';

export function SourcesView() {
  const openSource = useAppStore((s) => s.openSource);
  const detail = useAppStore((s) => s.detail);

  const visibleCount = useAppStore((s) => s.sourcesState.visibleCount);
  const query = useAppStore((s) => s.sourcesState.query);
  const setSourcesState = useAppStore((s) => s.setSourcesState);
  const normalizedQuery = query.trim().toLowerCase();

  const setQuery = useCallback(
    (value: string) => setSourcesState({ query: value, visibleCount: PAGE_SIZE }),
    [setSourcesState],
  );

  const setVisibleCount = useCallback(
    (updater: number | ((count: number) => number)) => {
      const current = useAppStore.getState().sourcesState.visibleCount;
      const next = typeof updater === 'function' ? updater(current) : updater;
      setSourcesState({ visibleCount: next });
    },
    [setSourcesState],
  );

  const scrollRestoredRef = useRef(false);

  const handleScrollPersist = useCallback((scrollTop: number) => {
    useAppStore.getState().setSourcesState({ scrollTop });
  }, []);

  useScrollSpy({
    scrollRootSelector: SCROLL_ROOT_SELECTOR,
    onScroll: handleScrollPersist,
  });

  const sources = useLiveQuery(async () => {
    const db = getDb();
    if (!normalizedQuery) {
      return db.sources.orderBy('ingestedAt').reverse().limit(visibleCount).toArray();
    }
    const matches = await db.sources
      .filter((source) => {
        const searchable = [
          source.title,
          source.author ?? '',
          source.url ?? '',
          SOURCE_TYPE_LABELS[source.type],
        ]
          .join(' ')
          .toLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .toArray();
    return matches.sort((a, b) => b.ingestedAt - a.ingestedAt);
  }, [normalizedQuery, visibleCount]);

  const totalSourceCount = useLiveQuery(async () => getDb().sources.count(), []);
  const sourceIdsKey = sources?.map((source) => source.id).join('\u0000') ?? '';

  const conceptCountBySource = useLiveQuery(async () => {
    if (!sources?.length) return new Map<string, number>();
    const db = getDb();
    const allConcepts = await db.concepts
      .where('sources')
      .anyOf(sources.map((source) => source.id))
      .toArray();
    const map = new Map<string, number>();
    for (const concept of allConcepts) {
      for (const sourceId of concept.sources) {
        map.set(sourceId, (map.get(sourceId) || 0) + 1);
      }
    }
    return map;
  }, [sourceIdsKey]);

  const matchedSources = useMemo(() => {
    if (!sources) return [];
    return sources;
  }, [sources]);

  const filteredSources = useMemo(
    () => matchedSources.slice(0, visibleCount),
    [matchedSources, visibleCount],
  );

  const totalMatches = normalizedQuery ? matchedSources.length : (totalSourceCount ?? 0);

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

  if (!sources)
    return (
      <div className="skeleton-sources" role="status" aria-label="正在加载资料" aria-busy="true">
        <div className="skeleton skeleton-header" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
        <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
      </div>
    );

  return (
    <>
      <div className="view-padding">
        {(totalSourceCount ?? 0) > 0 && (
          <div className="source-search-panel">
            <label className="search-label" htmlFor="source-search-input">
              搜索资料
            </label>
            <div className="search-wrap">
              <Icon.Search />
              <input
                id="source-search-input"
                className="search-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、作者或来源..."
                aria-label="搜索资料"
                autoComplete="off"
              />
            </div>
          </div>
        )}

        <div className="view-lead">
          <div className="view-lead-kicker">资料档案</div>
          <p className="view-lead-copy">
            这里保留你喂给知识库的原始材料。原文不被改写，只被引用和编译。
          </p>
        </div>
        {(totalSourceCount ?? 0) === 0 ? (
          <OnboardingCard variant="compact" />
        ) : (
          <>
            {totalMatches === 0 && (
              <div className="empty-state empty-state-compact" role="status" aria-live="polite">
                没有匹配的资料
              </div>
            )}
            {filteredSources.map((source) => (
              <button
                key={source.id}
                className={`source-card${detail?.type === 'source' && detail.id === source.id ? ' active' : ''}`}
                onClick={() => openSource(source.id)}
                type="button"
                aria-current={
                  detail?.type === 'source' && detail.id === source.id ? 'page' : undefined
                }
                aria-label={`${source.title}，${SOURCE_TYPE_LABELS[source.type]}，${conceptCountBySource?.get(source.id) ?? 0} 个概念`}
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
                type="button"
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
