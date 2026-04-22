'use client';

import { useState, useMemo, useEffect, useDeferredValue, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { LucideIcon } from 'lucide-react';
import {
  Binary,
  Bot,
  Brain,
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

  const concepts = useLiveQuery(
    async () => getDb().concepts.orderBy('updatedAt').reverse().toArray(),
    []
  );

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedPrimary, setSelectedPrimary] = useState<string | null>(null);
  const [selectedSecondary, setSelectedSecondary] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const main = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 4);
    onScroll();
    main.addEventListener('scroll', onScroll);
    return () => main.removeEventListener('scroll', onScroll);
  }, [scrollRootSelector]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [deferredQuery, selectedPrimary, selectedSecondary]);

  const categoryTree = useMemo(() => {
    if (!concepts) return [];
    return buildCategoryTree(concepts);
  }, [concepts]);

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
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.summary.toLowerCase().includes(q)
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
      const count = await categorizeConcepts((done, total) => {
        showToast(`正在归类... (${done}/${total})`, true);
      });
      showToast(`归类完成，处理了 ${count} 条`, false);
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
  const CurrentPrimaryIcon = getPrimaryCategoryIcon(selectedPrimary);

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
        <div className="view-lead-kicker">知识库</div>
        <p className="view-lead-copy">按领域分类浏览你的知识卡片。</p>
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
        <section className="library-filter-section library-filter-section-primary" aria-label="一级分类">
          <div className="library-filter-heading">
            <div>
              <span className="library-filter-eyebrow">一级分类</span>
              <span className="library-filter-hint">先选领域，再看细分方向</span>
            </div>
            <div className="library-filter-overview">
              <span className="library-filter-overview-label">当前范围</span>
              <strong>{selectedPrimary ?? '全部内容'}</strong>
            </div>
          </div>
          <div className="library-primary-board">
            <button
              className={`library-primary-card${selectedPrimary === null ? ' active' : ''}`}
              aria-pressed={selectedPrimary === null}
              onClick={() => { setSelectedPrimary(null); setSelectedSecondary(null); }}
            >
              <span className="library-primary-card-icon" aria-hidden="true">
                <Grid2x2 size={18} strokeWidth={1.9} />
              </span>
              <span className="library-primary-card-content">
                <span className="library-primary-card-topline">
                  <span className="library-primary-card-title">全部</span>
                  <span className="library-primary-card-count">{concepts.length}</span>
                </span>
                <span className="library-primary-card-meta">浏览全部分类内容</span>
              </span>
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
                    <PrimaryIcon size={18} strokeWidth={1.9} />
                  </span>
                  <span className="library-primary-card-content">
                    <span className="library-primary-card-topline">
                      <span className="library-primary-card-title">{cat.primary}</span>
                      <span className="library-primary-card-count">{cat.count}</span>
                    </span>
                    <span className="library-primary-card-meta">
                      {cat.secondaries.length > 0 ? `${cat.secondaries.length} 个细分方向` : '暂未细分方向'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {selectedPrimary && currentSecondaries.length > 0 && currentPrimaryNode && (
          <section className="library-filter-section library-filter-section-secondary" aria-label="二级标签">
            <div className="library-filter-heading">
              <div className="library-filter-heading-secondary-main">
                <span className="library-filter-eyebrow">二级标签</span>
                <span className="library-filter-hint">{selectedPrimary} 下的细分方向</span>
              </div>
              <div className="library-secondary-summary">
                <span className="library-secondary-summary-icon" aria-hidden="true">
                  <CurrentPrimaryIcon size={16} strokeWidth={1.9} />
                </span>
                <span className="library-secondary-summary-body">
                  <strong>{selectedPrimary}</strong>
                  <span>{currentSecondaries.length} 个方向 · {currentPrimaryNode.count} 条</span>
                </span>
              </div>
            </div>
            <div className="library-filter-row library-filter-row-secondary">
              <button
                className={`library-capsule secondary${selectedSecondary === null ? ' active' : ''}`}
                aria-pressed={selectedSecondary === null}
                onClick={() => setSelectedSecondary(null)}
              >
                全部方向
                <span className="library-capsule-count">{currentPrimaryNode.count}</span>
              </button>
              {currentSecondaries.map((sec) => (
                <button
                  key={sec.name}
                  className={`library-capsule secondary${selectedSecondary === sec.name ? ' active' : ''}`}
                  aria-pressed={selectedSecondary === sec.name}
                  onClick={() => {
                    setSelectedSecondary(selectedSecondary === sec.name ? null : sec.name);
                  }}
                >
                  {sec.name}
                  <span className="library-capsule-count">{sec.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="library-filter-status">{filterLabel}</div>

      {filtered.length === 0 ? (
        concepts.length === 0 ? (
          <div className="empty-state empty-state-spacious">
            <div className="es-icon">
              <Icon.Sparkle />
            </div>
            <h3>Wiki 还是空的</h3>
            <p>点击右下角 <strong>+</strong> 添加第一份资料，AI 会把它编译成你的第一批概念页。</p>
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
                      <span key={`${cat.primary}-${cat.secondary ?? ''}`} className="library-card-tag">
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
            <span>已显示 {visibleConcepts.length} / {filtered.length} 个概念</span>
          </div>
          {visibleConcepts.length < filtered.length && (
            <button className="modal-btn" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              加载更多
            </button>
          )}
        </>
      )}
    </>
  );
}
