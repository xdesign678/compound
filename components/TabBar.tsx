'use client';

import { useRef } from 'react';
import { useAppStore, type TabId } from '@/lib/store';
import { t, useLocale, type I18nKey } from '@/lib/i18n';
import { Icon } from './Icons';

// 标签称谓与移动端 Header 标题保持同源，避免「我的 Wiki / 知识库 / Wiki」多处不一致
const TABS: Array<{ id: TabId; labelKey: I18nKey; icon: React.ReactNode }> = [
  { id: 'wiki', labelKey: 'header.wiki.title', icon: <Icon.Wiki /> },
  { id: 'sources', labelKey: 'header.sources.title', icon: <Icon.Sources /> },
  { id: 'ask', labelKey: 'tab.ask', icon: <Icon.Ask /> },
  { id: 'activity', labelKey: 'tab.activity', icon: <Icon.Activity /> },
];

// Preload view chunk when user hovers/focuses a tab
const PRELOAD_MAP: Record<TabId, () => Promise<unknown>> = {
  wiki: () => import('@/components/views/WikiView'),
  sources: () => import('@/components/views/SourcesView'),
  ask: () => import('@/components/views/AskView'),
  activity: () => import('@/components/views/ActivityView'),
};
const preloaded = new Set<string>();

function preloadView(id: TabId) {
  if (preloaded.has(id)) return;
  preloaded.add(id);
  PRELOAD_MAP[id]().catch(() => {});
}

interface TabBarProps {
  variant?: 'bottom' | 'sidebar';
}

export function TabBar({ variant = 'bottom' }: TabBarProps) {
  useLocale();
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const setTab = useAppStore((s) => s.setTab);
  const openModal = useAppStore((s) => s.openModal);
  const isSidebar = variant === 'sidebar';
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // WAI-APG Tabs：方向键（横向 ←/→，纵向 ↑/↓）与 Home/End 漫游，自动激活跟随焦点
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const prevKey = isSidebar ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = isSidebar ? 'ArrowDown' : 'ArrowRight';
    let nextIndex: number | null = null;
    if (event.key === prevKey) nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === nextKey) nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
    setTab(TABS[nextIndex].id);
  };

  const renderTab = (item: (typeof TABS)[number], index: number, order?: number) => {
    const isActive = tab === item.id;
    const hasRenderedPanel = isActive && (isSidebar || !detail || tab === 'ask');
    return (
      <button
        key={item.id}
        type="button"
        id={`tab-${item.id}`}
        role="tab"
        aria-selected={isActive}
        aria-controls={hasRenderedPanel ? `tabpanel-${item.id}` : undefined}
        aria-current={isActive ? 'page' : undefined}
        tabIndex={isActive ? 0 : -1}
        ref={(el) => {
          tabRefs.current[index] = el;
        }}
        style={order === undefined ? undefined : { order }}
        className={`tab-item${isActive ? ' active' : ''}${isSidebar ? ' sidebar' : ''}`}
        onClick={() => setTab(item.id)}
        onKeyDown={(e) => handleTabKeyDown(e, index)}
        onMouseEnter={() => preloadView(item.id)}
        onFocus={() => preloadView(item.id)}
      >
        <span aria-hidden="true">{item.icon}</span>
        <span>{t(item.labelKey)}</span>
      </button>
    );
  };

  if (isSidebar) {
    return (
      <nav className="tabbar tabbar-sidebar" aria-label={t('tab.navLabel')}>
        <div role="tablist" aria-orientation="vertical">
          {TABS.map((item, index) => renderTab(item, index))}
        </div>
      </nav>
    );
  }

  const [first, second, ...rest] = TABS;

  // 「+」不是 tab，移出 tablist（ARIA 要求 tablist 只含 tab）；视觉仍居中：
  // 前两个 tab 与「+」为 order 0（按 DOM 序排列），后两个 tab order 1 排到其后。
  return (
    <nav className="tabbar" aria-label={t('tab.navLabel')}>
      <div role="tablist" aria-orientation="horizontal" className="tabbar-tabs">
        {renderTab(first, 0)}
        {renderTab(second, 1)}
        {rest.map((item, i) => renderTab(item, i + 2, 1))}
      </div>
      <button type="button" className="tab-add" aria-label={t('tab.addSource')} onClick={openModal}>
        <span className="tab-add-btn" aria-hidden="true">
          <Icon.Plus />
        </span>
      </button>
    </nav>
  );
}
