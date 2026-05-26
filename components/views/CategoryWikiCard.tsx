'use client';

import { memo, useEffect, useState } from 'react';
import { getCategoryWiki } from '@/lib/api-client';
import { useAppStore } from '@/lib/store';
import { Icon } from '../Icons';
import type { CategoryWiki } from '@/lib/types';

interface CategoryWikiCardProps {
  primary: string;
  secondary: string;
  conceptCount: number;
  isActive: boolean;
}

export const CategoryWikiCard = memo(function CategoryWikiCard({
  primary,
  secondary,
  conceptCount,
  isActive,
}: CategoryWikiCardProps) {
  const openCategoryWiki = useAppStore((s) => s.openCategoryWiki);
  const [wiki, setWiki] = useState<CategoryWiki | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getCategoryWiki(primary, secondary)
      .then((result) => {
        if (!cancelled) setWiki(result);
      })
      .catch(() => {
        if (!cancelled) setWiki(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primary, secondary]);

  const statusLabel =
    wiki === undefined
      ? '检查中...'
      : wiki === null
        ? '未生成'
        : wiki.stale
          ? '内容有更新'
          : `已生成`;

  const statusClass =
    wiki === undefined
      ? ''
      : wiki === null
        ? 'category-wiki-card-status--pending'
        : wiki.stale
          ? 'category-wiki-card-status--stale'
          : 'category-wiki-card-status--ready';

  return (
    <button
      className={`concept-card category-wiki-card${isActive ? ' active' : ''}`}
      onClick={() => openCategoryWiki(primary, secondary)}
      data-category-wiki={`${primary}/${secondary}`}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      aria-label={`${secondary} Wiki，${conceptCount} 个概念`}
    >
      <div className="category-wiki-card-header">
        <span className="category-wiki-card-icon" aria-hidden="true">
          <Icon.Sparkle />
        </span>
        <span className="title">{secondary} Wiki</span>
      </div>
      <div className="summary">综合这 {conceptCount} 个概念，生成完整的主题百科，看完就懂。</div>
      <div className="meta">
        <span className={`category-wiki-card-status ${statusClass}`}>{statusLabel}</span>
        <span>·</span>
        <span>{conceptCount} 个概念</span>
      </div>
    </button>
  );
});
