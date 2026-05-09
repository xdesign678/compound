'use client';

import { useAppStore, type TabId } from '@/lib/store';
import { t, useLocale, type I18nKey } from '@/lib/i18n';
import { Icon } from './Icons';

const TABS: Array<{ id: TabId; labelKey: I18nKey; icon: React.ReactNode }> = [
  { id: 'wiki', labelKey: 'tab.wiki', icon: <Icon.Wiki /> },
  { id: 'sources', labelKey: 'tab.sources', icon: <Icon.Sources /> },
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
  const setTab = useAppStore((s) => s.setTab);
  const openModal = useAppStore((s) => s.openModal);
  const isSidebar = variant === 'sidebar';

  const renderTab = (item: (typeof TABS)[number]) => {
    const isActive = tab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        id={`tab-${item.id}`}
        role="tab"
        aria-selected={isActive}
        aria-controls={`tabpanel-${item.id}`}
        aria-current={isActive ? 'page' : undefined}
        className={`tab-item${isActive ? ' active' : ''}${isSidebar ? ' sidebar' : ''}`}
        onClick={() => setTab(item.id)}
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
          {TABS.map(renderTab)}
        </div>
      </nav>
    );
  }

  const [first, second, ...rest] = TABS;

  return (
    <nav className="tabbar" aria-label={t('tab.navLabel')}>
      <div role="tablist" aria-orientation="horizontal" className="tabbar-tabs">
        {renderTab(first)}
        {renderTab(second)}
        {rest.map(renderTab)}
      </div>
      <button type="button" className="tab-add" aria-label={t('tab.addSource')} onClick={openModal}>
        <span className="tab-add-btn" aria-hidden="true">
          <Icon.Plus />
        </span>
      </button>
    </nav>
  );
}
