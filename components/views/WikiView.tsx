'use client';

import {
  useState,
  useMemo,
  useEffect,
  useDeferredValue,
  useRef,
  useLayoutEffect,
  useCallback,
  memo,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { getDb } from '@/lib/db';
import { searchWikiContext } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { getUnreviewedCountFromDb } from '@/lib/review-picks';
import { useScrollSpy } from '@/lib/hooks/useScrollSpy';
import { useIntersectionAnchor } from '@/lib/hooks/useIntersectionAnchor';
import { Icon } from '../Icons';
import type { Concept } from '@/lib/types';

interface WikiViewProps {
  scrollRootSelector?: string;
}

const PAGE_SIZE = 60;
// 与 lib/review-picks.ts 的 TARGET_COUNT 保持一致：复盘 deck 最多取这么多张
const RECAP_DECK_TARGET = 8;

const WikiCard = memo(function WikiCard({
  concept,
  isFresh,
  isActive,
  onOpen,
}: {
  concept: Concept;
  isFresh: boolean;
  isActive: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      className={`concept-card${isFresh ? ' fresh' : ''}${isActive ? ' active' : ''}`}
      onClick={() => onOpen(concept.id)}
      data-concept-id={concept.id}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={`${concept.title}，${concept.related.length} 个链接，来自 ${concept.sources.length} 份资料`}
    >
      <div className="title">{concept.title}</div>
      <div className="summary">{concept.summary}</div>
      <div className="meta">
        <span className="badge-link">
          <Icon.Link />
          {concept.related.length} 链接
        </span>
        <span>·</span>
        <span>来自 {concept.sources.length} 份资料</span>
        <span>·</span>
        <span className={isFresh ? 'updated' : ''}>{formatRelativeTime(concept.updatedAt)}</span>
      </div>
    </button>
  );
});

export function WikiView({ scrollRootSelector = '.app-main' }: WikiViewProps) {
  const router = useRouter();
  const openConcept = useAppStore((s) => s.openConcept);
  const freshIds = useAppStore((s) => s.freshConceptIds);
  const detail = useAppStore((s) => s.detail);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [serverConcepts, setServerConcepts] = useState<Concept[] | null>(null);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);
  const scrollRestoredRef = useRef(false);

  const handleWikiScroll = useCallback((scrollTop: number) => {
    useAppStore.getState().setWikiState({ scrollTop });
  }, []);

  useScrollSpy({ scrollRootSelector, onScroll: handleWikiScroll });

  // IntersectionObserver-based scroll anchor — replaces per-frame
  // querySelectorAll + getBoundingClientRect forced reflows.
  const handleAnchorChange = useCallback((anchorId: string | null) => {
    useAppStore.getState().setWikiState({ scrollAnchorId: anchorId });
  }, []);

  const { observeCards } = useIntersectionAnchor({
    scrollRootSelector,
    itemSelector: '[data-concept-id]',
    onAnchorChange: handleAnchorChange,
  });

  const localConcepts = useLiveQuery(async () => {
    const q = deferredQuery.trim().toLowerCase();
    const collection = getDb().concepts.orderBy('updatedAt').reverse();
    if (!q) {
      return collection.limit(visibleCount).toArray();
    }
    return collection
      .filter((concept) => {
        return concept.title.toLowerCase().includes(q) || concept.summary.toLowerCase().includes(q);
      })
      .limit(visibleCount)
      .toArray();
  }, [deferredQuery, visibleCount]);

  const totalConceptCount = useLiveQuery(async () => {
    return getDb().concepts.count();
  }, []);

  const totalMatches = useLiveQuery(async () => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return getDb().concepts.count();
    return getDb()
      .concepts.orderBy('updatedAt')
      .reverse()
      .filter((concept) => {
        return concept.title.toLowerCase().includes(q) || concept.summary.toLowerCase().includes(q);
      })
      .count();
  }, [deferredQuery]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery]);

  useEffect(() => {
    const q = deferredQuery.trim();
    if (!q) {
      setServerConcepts(null);
      setServerSearchLoading(false);
      return;
    }

    let cancelled = false;
    setServerSearchLoading(true);
    searchWikiContext({ query: q, conceptLimit: visibleCount, chunkLimit: 8 })
      .then((result) => {
        if (cancelled) return;
        setServerConcepts(result.concepts);
        if (result.concepts.length > 0) {
          void getDb().concepts.bulkPut(
            result.concepts.map((concept) => ({ ...concept, contentStatus: 'full' as const })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setServerConcepts(null);
      })
      .finally(() => {
        if (!cancelled) setServerSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deferredQuery, visibleCount]);

  useEffect(() => {
    getUnreviewedCountFromDb().then(setUnreviewedCount);
  }, [totalConceptCount]);

  // 服务端返回 0 条时回退本地结果，否则本地明明有匹配也显示「没有匹配的概念」
  const concepts = serverConcepts && serverConcepts.length > 0 ? serverConcepts : localConcepts;

  // Re-observe cards when the concept list changes (new data, pagination, etc.)
  useEffect(() => {
    observeCards();
  }, [concepts, observeCards]);

  const fresh = useMemo(() => (concepts ?? []).filter((c) => freshIds[c.id]), [concepts, freshIds]);
  const others = useMemo(
    () => (concepts ?? []).filter((c) => !freshIds[c.id]),
    [concepts, freshIds],
  );

  useLayoutEffect(() => {
    if (scrollRestoredRef.current) return;
    if (!concepts) return;
    const main = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!main) return;
    scrollRestoredRef.current = true;

    const restore = () => {
      const { scrollAnchorId, scrollTop } = useAppStore.getState().wikiState;
      if (scrollAnchorId) {
        const card = main.querySelector(
          `[data-concept-id="${scrollAnchorId}"]`,
        ) as HTMLElement | null;
        if (card) {
          card.scrollIntoView({ block: 'center' });
          return;
        }
      }
      if (scrollTop > 0) main.scrollTop = scrollTop;
    };

    requestAnimationFrame(restore);
  }, [concepts, scrollRootSelector]);

  if (!concepts) {
    return (
      <div className="skeleton-sources" role="status" aria-label="正在加载知识库" aria-busy="true">
        <div className="skeleton skeleton-header" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
        <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
      </div>
    );
  }

  const hasAnyConcepts = (totalConceptCount ?? 0) > 0;
  const totalVisibleMatches = serverConcepts
    ? serverConcepts.length
    : (totalMatches ?? concepts.length);
  const hasMatches = totalVisibleMatches > 0 || serverSearchLoading;
  const recapDeckCount = Math.min(unreviewedCount, RECAP_DECK_TARGET);

  return (
    <>
      {hasAnyConcepts && (
        <div className="concept-list" style={{ marginBottom: 'var(--space-md)' }}>
          <div>
            <label className="search-label" htmlFor="wiki-search-input">
              搜索概念
            </label>
            <div className="search-wrap">
              <Icon.Search />
              <input
                id="wiki-search-input"
                className="search-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索概念标题或摘要..."
                aria-label="搜索概念"
                autoComplete="off"
              />
            </div>
          </div>
        </div>
      )}
      {/* 搜索激活时隐藏今日复盘入口，避免稀释空态与搜索引导 */}
      {unreviewedCount > 0 && !deferredQuery.trim() && (
        <div className="concept-list recap-entry-list">
          <button
            className="concept-card recap-entry-card"
            onClick={() => router.push('/recap')}
            type="button"
            aria-label={
              unreviewedCount > RECAP_DECK_TARGET
                ? `今日复盘，本次 ${recapDeckCount} 张，共 ${unreviewedCount} 个概念待回顾`
                : `今日复盘，共 ${unreviewedCount} 个概念待回顾`
            }
          >
            <span className="recap-entry-main">
              <span className="recap-entry-title">
                <Icon.Sparkle />
                今日复盘
              </span>
              <span className="recap-entry-count">
                {unreviewedCount > RECAP_DECK_TARGET
                  ? `本次 ${recapDeckCount} / 共 ${unreviewedCount} 待回顾`
                  : `${unreviewedCount} 个待回顾`}
              </span>
            </span>
            <span className="recap-entry-action">
              <Icon.Send />
            </span>
          </button>
        </div>
      )}
      {!hasMatches ? (
        !hasAnyConcepts ? (
          <div className="empty-state empty-state-spacious" role="status" aria-live="polite">
            <div className="es-icon" aria-hidden="true">
              <Icon.Sparkle />
            </div>
            <h3>Wiki 还是空的</h3>
            <p>
              点击右下角 <strong>+</strong> 添加第一份资料，AI 会把它编译成你的第一批概念页。
            </p>
          </div>
        ) : (
          <div className="empty-state" role="status">
            <p>没有匹配的概念</p>
            <button className="modal-btn" onClick={() => setQuery('')} type="button">
              清空搜索
            </button>
          </div>
        )
      ) : (
        <>
          {fresh.length > 0 && (
            <>
              <div className="section-heading" role="heading" aria-level={2}>
                刚更新 <span className="section-heading-count">({fresh.length})</span>
              </div>
              <div className="concept-list">
                {fresh.map((c) => (
                  <WikiCard
                    key={c.id}
                    concept={c}
                    isFresh={!!freshIds[c.id]}
                    isActive={detail?.type === 'concept' && detail.id === c.id}
                    onOpen={openConcept}
                  />
                ))}
              </div>
            </>
          )}
          {others.length > 0 && (
            <>
              <div className="section-heading" role="heading" aria-level={2}>
                全部概念
              </div>
              <div className="concept-list">
                {others.map((c) => (
                  <WikiCard
                    key={c.id}
                    concept={c}
                    isFresh={!!freshIds[c.id]}
                    isActive={detail?.type === 'concept' && detail.id === c.id}
                    onOpen={openConcept}
                  />
                ))}
              </div>
            </>
          )}
          {concepts.length < totalVisibleMatches ? (
            <div className="list-load-more">
              <span className="list-load-more-hint">
                {serverSearchLoading ? '服务端检索中 · ' : ''}已显示 {concepts.length} /{' '}
                {totalVisibleMatches} 个概念
              </span>
              <button
                className="modal-btn"
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
                加载更多
              </button>
            </div>
          ) : (
            <div className="list-end-hint">
              <span>
                {serverSearchLoading ? '服务端检索中 · ' : ''}已显示 {concepts.length} /{' '}
                {totalVisibleMatches} 个概念 · 点击 + 添加更多知识
              </span>
            </div>
          )}
        </>
      )}
    </>
  );
}
