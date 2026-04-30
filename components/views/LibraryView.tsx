'use client';

import {
  useState,
  useMemo,
  useEffect,
  useDeferredValue,
  useCallback,
  useRef,
  useLayoutEffect,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LucideIcon } from 'lucide-react';
import {
  Binary,
  Bot,
  Brain,
  ChevronLeft,
  ChevronRight,
  Compass,
  FolderKanban,
  Grid2x2,
  History,
  Network,
  Wrench,
} from 'lucide-react';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatRelativeTime } from '@/lib/format';
import { categorizeConcepts } from '@/lib/api-client';
import { formatCategorizeCompletionMessage } from '@/lib/categorize-status';
import { Icon } from '../Icons';
import type { Concept, CategoryTag } from '@/lib/types';

interface LibraryViewProps {
  scrollRootSelector?: string;
}

const PAGE_SIZE = 60;

interface CategoryTree {
  primary: string;
  count: number;
  secondaries: Array<{ name: string; count: number }>;
}

const PRIMARY_CATEGORY_ICON_RULES: Array<{ match: RegExp; icon: LucideIcon }> = [
  { match: /脑|神经|认知|意识|心理/, icon: Brain },
  { match: /方法|哲学|理论/, icon: Compass },
  { match: /进化|社会|人类/, icon: Network },
  { match: /人工智能|AI|机器学习|大模型/, icon: Bot },
  { match: /知识|笔记|管理|学习/, icon: FolderKanban },
  { match: /软件|编程|开发|工程/, icon: Binary },
  { match: /工具|效率|工作流/, icon: Wrench },
  { match: /历史|传记|文明/, icon: History },
];

function getPrimaryCategoryIcon(primary: string | null): LucideIcon {
  if (!primary) return Grid2x2;
  return PRIMARY_CATEGORY_ICON_RULES.find((rule) => rule.match.test(primary))?.icon ?? Grid2x2;
}

function buildCategoryTree(concepts: Concept[]): CategoryTree[] {
  const primaryMap = new Map<string, Map<string, number>>();

  for (const c of concepts) {
    if (!c.categories) continue;
    for (const cat of c.categories) {
      if (!cat.primary) continue;
      if (!primaryMap.has(cat.primary)) {
        primaryMap.set(cat.primary, new Map());
      }
      const secMap = primaryMap.get(cat.primary)!;
      const secKey = cat.secondary || '';
      secMap.set(secKey, (secMap.get(secKey) || 0) + 1);
    }
  }

  const tree: CategoryTree[] = [];
  for (const [primary, secMap] of primaryMap) {
    const secondaries: Array<{ name: string; count: number }> = [];
    let totalCount = 0;
    for (const [name, count] of secMap) {
      if (name) secondaries.push({ name, count });
      totalCount += count;
    }
    secondaries.sort((a, b) => b.count - a.count);
    tree.push({ primary, count: totalCount, secondaries });
  }
  tree.sort((a, b) => b.count - a.count);
  return tree;
}

export function LibraryView({ scrollRootSelector = '.app-main' }: LibraryViewProps) {
  const openConcept = useAppStore((s) => s.openConcept);
  const detail = useAppStore((s) => s.detail);
  const showToast = useAppStore((s) => s.showToast);
  const hideToast = useAppStore((s) => s.hideToast);
  const setSearchCollapsed = useAppStore((s) => s.setSearchCollapsed);
  const searchFocusNonce = useAppStore((s) => s.searchFocusNonce);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const query = useAppStore((s) => s.libraryState.query);
  const selectedPrimary = useAppStore((s) => s.libraryState.selectedPrimary);
  const selectedSecondary = useAppStore((s) => s.libraryState.selectedSecondary);
  const visibleCount = useAppStore((s) => s.libraryState.visibleCount);
  const showAllSecondaries = useAppStore((s) => s.libraryState.showAllSecondaries);
  const setLibraryState = useAppStore((s) => s.setLibraryState);

  const setQuery = useCallback((v: string) => setLibraryState({ query: v }), [setLibraryState]);
  const setSelectedPrimary = useCallback(
    (v: string | null) => setLibraryState({ selectedPrimary: v }),
    [setLibraryState],
  );
  const setSelectedSecondary = useCallback(
    (v: string | null) => setLibraryState({ selectedSecondary: v }),
    [setLibraryState],
  );
  const setVisibleCount = useCallback(
    (updater: number | ((count: number) => number)) => {
      const current = useAppStore.getState().libraryState.visibleCount;
      const next = typeof updater === 'function' ? updater(current) : updater;
      setLibraryState({ visibleCount: next });
    },
    [setLibraryState],
  );
  const setShowAllSecondaries = useCallback(
    (updater: boolean | ((v: boolean) => boolean)) => {
      const current = useAppStore.getState().libraryState.showAllSecondaries;
      const next = typeof updater === 'function' ? updater(current) : updater;
      setLibraryState({ showAllSecondaries: next });
    },
    [setLibraryState],
  );

  const concepts = useLiveQuery(
    async () => getDb().concepts.orderBy('updatedAt').reverse().toArray(),
    [],
  );

  const deferredQuery = useDeferredValue(query);
  const [scrolled, setScrolled] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [primaryRailState, setPrimaryRailState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const primaryRailRef = useRef<HTMLDivElement | null>(null);
  const filterResetSkipRef = useRef(true);
  const scrollRestoredRef = useRef(false);

  useEffect(() => {
    const main = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!main) return;
    let raf = 0;
    let pendingY: number | null = null;
    const flush = () => {
      raf = 0;
      if (pendingY !== null) {
        useAppStore.getState().setLibraryState({ scrollTop: pendingY });
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
        useAppStore.getState().setLibraryState({ scrollTop: pendingY });
      }
    };
  }, [scrollRootSelector, setSearchCollapsed]);

  useLayoutEffect(() => {
    if (scrollRestoredRef.current) return;
    if (!concepts) return;
    const main = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!main) return;
    scrollRestoredRef.current = true;
    const saved = useAppStore.getState().libraryState.scrollTop;
    if (saved > 0) {
      main.scrollTop = saved;
    }
  }, [concepts, scrollRootSelector]);

  useEffect(() => {
    if (searchFocusNonce === 0) return;
    const id = window.setTimeout(() => searchInputRef.current?.focus(), 240);
    return () => window.clearTimeout(id);
  }, [searchFocusNonce]);

  useEffect(() => {
    if (filterResetSkipRef.current) {
      filterResetSkipRef.current = false;
      return;
    }
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery, selectedPrimary, selectedSecondary, setVisibleCount]);

  const syncPrimaryRailState = useCallback(() => {
    const rail = primaryRailRef.current;
    if (!rail) return;
    setPrimaryRailState({
      canScrollLeft: rail.scrollLeft > 8,
      canScrollRight: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 8,
    });
  }, []);

  const scrollPrimaryRail = useCallback((direction: -1 | 1) => {
    const rail = primaryRailRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * 320, behavior: 'smooth' });
  }, []);

  const categoryTree = useMemo(() => {
    if (!concepts) return [];
    return buildCategoryTree(concepts);
  }, [concepts]);

  useEffect(() => {
    const rail = primaryRailRef.current;
    if (!rail) return;
    syncPrimaryRailState();
    const handleResize = () => syncPrimaryRailState();
    rail.addEventListener('scroll', syncPrimaryRailState, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      rail.removeEventListener('scroll', syncPrimaryRailState);
      window.removeEventListener('resize', handleResize);
    };
  }, [categoryTree.length, syncPrimaryRailState]);

  const uncategorizedCount = useMemo(() => {
    if (!concepts) return 0;
    return concepts.filter((c) => !c.categories || c.categories.length === 0).length;
  }, [concepts]);

  const currentSecondaries = useMemo(() => {
    if (!selectedPrimary) return [];
    const node = categoryTree.find((t) => t.primary === selectedPrimary);
    return node?.secondaries || [];
  }, [categoryTree, selectedPrimary]);

  const currentPrimaryNode = useMemo(() => {
    if (!selectedPrimary) return null;
    return categoryTree.find((t) => t.primary === selectedPrimary) ?? null;
  }, [categoryTree, selectedPrimary]);

  const SECONDARY_INITIAL_COUNT = 8;

  const visibleSecondaries = useMemo(() => {
    if (showAllSecondaries) return currentSecondaries;
    return currentSecondaries.slice(0, SECONDARY_INITIAL_COUNT);
  }, [currentSecondaries, showAllSecondaries]);

  const hasMoreSecondaries = currentSecondaries.length > SECONDARY_INITIAL_COUNT;

  const filtered = useMemo(() => {
    if (!concepts) return [];
    let result = concepts;

    if (selectedPrimary) {
      result = result.filter((c) => {
        if (!c.categories) return false;
        return c.categories.some((cat) => {
          if (cat.primary !== selectedPrimary) return false;
          if (selectedSecondary && cat.secondary !== selectedSecondary) return false;
          return true;
        });
      });
    }

    if (deferredQuery.trim()) {
      const q = deferredQuery.toLowerCase();
      result = result.filter(
        (c) => c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q),
      );
    }

    return result;
  }, [concepts, selectedPrimary, selectedSecondary, deferredQuery]);

  const visibleConcepts = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  const handleCategorize = useCallback(async () => {
    if (categorizing) return;
    setCategorizing(true);
    showToast('正在归类...', true);
    try {
      const result = await categorizeConcepts((done, total) => {
        showToast(`正在归类... (${done}/${total})`, true);
      });
      showToast(formatCategorizeCompletionMessage(result), false, result.failed > 0);
      setTimeout(() => hideToast(), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`归类失败: ${msg.slice(0, 80)}`, false);
      setTimeout(() => hideToast(), 4000);
    } finally {
      setCategorizing(false);
    }
  }, [categorizing, showToast, hideToast]);

  if (!concepts) {
    return <div className="empty-state">加载中...</div>;
  }

  const filterLabel = selectedPrimary
    ? selectedSecondary
      ? `${selectedPrimary} > ${selectedSecondary} · ${filtered.length} 条`
      : `${selectedPrimary} · ${filtered.length} 条`
    : `共 ${filtered.length} 条`;

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

      {uncategorizedCount > 0 && (
        <div className="library-categorize-banner">
          <span>有 {uncategorizedCount} 条未分类内容</span>
          <button
            className="modal-btn primary library-categorize-btn"
            onClick={handleCategorize}
            disabled={categorizing}
          >
            {categorizing ? '归类中...' : '自动归类'}
          </button>
        </div>
      )}

      <div className="library-filter-stack">
        <section
          className="library-filter-section library-filter-section-primary"
          aria-label="一级分类"
        >
          <div className="library-filter-heading">
            <div className="library-filter-heading-main">
              <span className="library-filter-eyebrow">一级分类</span>
              <span className="library-filter-hint">先选领域，再看细分方向</span>
            </div>
            <div
              className="library-primary-controls"
              aria-hidden={!primaryRailState.canScrollLeft && !primaryRailState.canScrollRight}
            >
              <button
                className="library-primary-scroll-btn"
                type="button"
                onClick={() => scrollPrimaryRail(-1)}
                disabled={!primaryRailState.canScrollLeft}
                aria-label="向左滚动分类"
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
              <button
                className="library-primary-scroll-btn"
                type="button"
                onClick={() => scrollPrimaryRail(1)}
                disabled={!primaryRailState.canScrollRight}
                aria-label="向右滚动分类"
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="library-primary-rail" ref={primaryRailRef}>
            <div className="library-primary-board">
              <button
                className={`library-primary-card${selectedPrimary === null ? ' active' : ''}`}
                aria-pressed={selectedPrimary === null}
                onClick={() => {
                  setSelectedPrimary(null);
                  setSelectedSecondary(null);
                }}
              >
                <span className="library-primary-card-icon" aria-hidden="true">
                  <Grid2x2 size={28} strokeWidth={1.85} />
                </span>
                <span className="library-primary-card-title">全部</span>
                <span className="library-primary-card-count">{concepts.length}</span>
              </button>
              {categoryTree.map((cat) => {
                const PrimaryIcon = getPrimaryCategoryIcon(cat.primary);
                return (
                  <button
                    key={cat.primary}
                    className={`library-primary-card${selectedPrimary === cat.primary ? ' active' : ''}`}
                    aria-pressed={selectedPrimary === cat.primary}
                    onClick={() => {
                      if (selectedPrimary === cat.primary) {
                        setSelectedPrimary(null);
                        setSelectedSecondary(null);
                      } else {
                        setSelectedPrimary(cat.primary);
                        setSelectedSecondary(null);
                      }
                    }}
                  >
                    <span className="library-primary-card-icon" aria-hidden="true">
                      <PrimaryIcon size={28} strokeWidth={1.85} />
                    </span>
                    <span className="library-primary-card-title">{cat.primary}</span>
                    <span className="library-primary-card-count">{cat.count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {selectedPrimary && currentSecondaries.length > 0 && currentPrimaryNode && (
          <section
            className="library-filter-section library-filter-section-secondary"
            aria-label="二级标签"
          >
            <div className="library-filter-heading library-filter-heading-secondary">
              <div className="library-filter-heading-main">
                <span className="library-filter-eyebrow">
                  二级标签（{selectedPrimary} · {currentPrimaryNode.count}）
                </span>
              </div>
            </div>
            <div className="library-filter-row library-filter-row-secondary">
              <button
                className={`library-secondary-chip${selectedSecondary === null ? ' active' : ''}`}
                aria-pressed={selectedSecondary === null}
                onClick={() => setSelectedSecondary(null)}
              >
                <span className="library-secondary-chip-inner">
                  <span className="library-secondary-chip-label">全部方向</span>
                  <span className="library-secondary-chip-count">{currentPrimaryNode.count}</span>
                </span>
                <ChevronRight
                  size={14}
                  strokeWidth={2}
                  className="library-secondary-chip-arrow"
                  aria-hidden="true"
                />
              </button>
              {visibleSecondaries.map((sec) => (
                <button
                  key={sec.name}
                  className={`library-secondary-chip${selectedSecondary === sec.name ? ' active' : ''}`}
                  aria-pressed={selectedSecondary === sec.name}
                  onClick={() => {
                    setSelectedSecondary(selectedSecondary === sec.name ? null : sec.name);
                  }}
                >
                  <span className="library-secondary-chip-inner">
                    <span className="library-secondary-chip-label">{sec.name}</span>
                    <span className="library-secondary-chip-count">{sec.count}</span>
                  </span>
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className="library-secondary-chip-arrow"
                    aria-hidden="true"
                  />
                </button>
              ))}
              {hasMoreSecondaries && (
                <button
                  className="library-secondary-chip library-secondary-more"
                  onClick={() => setShowAllSecondaries((v) => !v)}
                >
                  <span className="library-secondary-chip-inner">
                    <span className="library-secondary-chip-label">
                      {showAllSecondaries ? '收起标签' : '更多标签'}
                    </span>
                  </span>
                  <ChevronRight
                    size={14}
                    strokeWidth={2}
                    className={`library-secondary-chip-arrow${showAllSecondaries ? ' is-open' : ''}`}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      <div className="library-filter-status">{filterLabel}</div>

      {selectedPrimary && deferredQuery.trim() && (
        <div className="filter-indicator">
          <span className="filter-indicator-text">
            在{' '}
            <strong>
              {selectedSecondary ? `${selectedPrimary} › ${selectedSecondary}` : selectedPrimary}
            </strong>{' '}
            中搜索 &ldquo;{deferredQuery.trim()}&rdquo;
          </span>
          <div className="filter-indicator-actions">
            <button className="filter-indicator-clear" onClick={() => setQuery('')} type="button">
              清除搜索词
            </button>
            <button
              className="filter-indicator-clear"
              onClick={() => {
                setSelectedPrimary(null);
                setSelectedSecondary(null);
              }}
              type="button"
            >
              取消分类
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        concepts.length === 0 ? (
          <div className="empty-state empty-state-spacious">
            <div className="es-icon">
              <Icon.Sparkle />
            </div>
            <h3>Wiki 还是空的</h3>
            <p>
              点击右下角 <strong>+</strong> 添加第一份资料，AI 会把它编译成你的第一批概念页。
            </p>
          </div>
        ) : (
          <div className="empty-state">没有匹配的概念</div>
        )
      ) : (
        <>
          <div className="library-grid">
            {visibleConcepts.map((c) => (
              <button
                key={c.id}
                className={`concept-card${detail?.type === 'concept' && detail.id === c.id ? ' active' : ''}`}
                onClick={() => openConcept(c.id)}
              >
                <div className="title">{c.title}</div>
                <div className="summary">{c.summary}</div>
                {c.categories && c.categories.length > 0 && (
                  <div className="library-card-tags">
                    {c.categories.map((cat) => (
                      <span
                        key={`${cat.primary}-${cat.secondary ?? ''}`}
                        className="library-card-tag"
                      >
                        {cat.secondary || cat.primary}
                      </span>
                    ))}
                  </div>
                )}
                <div className="meta">
                  <span className="badge-link">
                    <Icon.Link />
                    {c.related.length} 链接
                  </span>
                  <span>·</span>
                  <span>{formatRelativeTime(c.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
          <div className="list-end-hint">
            <span>
              已显示 {visibleConcepts.length} / {filtered.length} 个概念
            </span>
          </div>
          {visibleConcepts.length < filtered.length && (
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
