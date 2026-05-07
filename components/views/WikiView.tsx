'use client';

import { useState, useMemo, useEffect, useDeferredValue, useRef, memo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { getDb } from '@/lib/db';
import { searchWikiContext } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { getUnreviewedCountFromDb } from '@/lib/review-picks';
import { useScrollSpy } from '@/lib/hooks/useScrollSpy';
import { Icon } from '../Icons';
import type { Concept } from '@/lib/types';

interface WikiViewProps {
  scrollRootSelector?: string;
}

const PAGE_SIZE = 60;

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
  const searchFocusNonce = useAppStore((s) => s.searchFocusNonce);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [serverConcepts, setServerConcepts] = useState<Concept[] | null>(null);
  const [serverSearchLoading, setServerSearchLoading] = useState(false);

  const { scrolled } = useScrollSpy({ scrollRootSelector });

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
    if (searchFocusNonce === 0) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 240);
    return () => window.clearTimeout(id);
  }, [searchFocusNonce]);

  useEffect(() => {
    getUnreviewedCountFromDb().then(setUnreviewedCount);
  }, [totalConceptCount]);

  const concepts = serverConcepts ?? localConcepts;
  const fresh = useMemo(() => (concepts ?? []).filter((c) => freshIds[c.id]), [concepts, freshIds]);
  const others = useMemo(
    () => (concepts ?? []).filter((c) => !freshIds[c.id]),
    [concepts, freshIds],
  );

  if (!concepts) {
    return <div className="empty-state">加载中...</div>;
  }

  const hasAnyConcepts = (totalConceptCount ?? 0) > 0;
  const totalVisibleMatches = serverConcepts
    ? serverConcepts.length
    : (totalMatches ?? concepts.length);
  const hasMatches = totalVisibleMatches > 0 || serverSearchLoading;

  return (
    <>
      <div className={`search-bar-slot${scrolled ? ' is-collapsed' : ''}`}>
        <div className={`search-bar ${scrolled ? 'scrolled' : ''}`}>
          <div className="search-label">检索概念、摘要与引用</div>
          <div className="search-wrap">
            <Icon.Search />
            <input
              ref={searchInputRef}
              className="search-input"
              placeholder="搜索概念、资料、引用..."
              aria-label="搜索概念"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      {unreviewedCount > 0 && (
        <div className="concept-list recap-entry-list">
          <button
            className="concept-card recap-entry-card"
            onClick={() => router.push('/recap')}
            type="button"
            aria-label={`今日复盘，共 ${unreviewedCount} 个概念待回顾`}
          >
            <span className="recap-entry-main">
              <span className="recap-entry-title">
                <Icon.Sparkle />
                今日复盘
              </span>
              <span className="recap-entry-count">{unreviewedCount} 个待回顾</span>
            </span>
            <span className="recap-entry-action">
              <Icon.Send />
            </span>
          </button>
        </div>
      )}
      {!hasMatches ? (
        !hasAnyConcepts ? (
          <div className="empty-state empty-state-spacious">
            <div className="es-icon">
              <Icon.Sparkle />
            </div>
            <h3>Wiki 还是空的</h3>
            <p>
              点击右下角 <strong>+</strong> 添加第一份资料,AI 会把它编译成你的第一批概念页。
            </p>
          </div>
        ) : (
          <div className="empty-state">
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
              <div className="section-heading">
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
              <div className="section-heading">全部概念</div>
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
          <div className="list-end-hint">
            <span>
              {serverSearchLoading ? '服务端检索中 · ' : ''}已显示 {concepts.length} /{' '}
              {totalVisibleMatches} 个概念 · 点击 + 添加更多知识
            </span>
          </div>
          {concepts.length < totalVisibleMatches && (
            <button
              className="modal-btn"
              onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            >
              加载更多
            </button>
          )}
        </>
      )}
    </>
  );
}
