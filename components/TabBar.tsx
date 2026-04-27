'use client';

import { useAppStore, type TabId } from '@/lib/store';
import { Icon } from './Icons';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'wiki', label: 'Wiki', icon: <Icon.Wiki /> },
  { id: 'sources', label: '资料', icon: <Icon.Sources /> },
  { id: 'ask', label: '问答', icon: <Icon.Ask /> },
  { id: 'activity', label: '活动', icon: <Icon.Activity /> },
];

interface TabBarProps {
  variant?: 'bottom' | 'sidebar';
}

export function TabBar({ variant = 'bottom' }: TabBarProps) {
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const openModal = useAppStore((s) => s.openModal);
  const isSidebar = variant === 'sidebar';

  const renderTab = (t: typeof TABS[number]) => {
    const isActive = tab === t.id;
    return (
      <button
        key={t.id}
        role="tab"
        aria-selected={isActive}
        aria-current={isActive ? 'page' : undefined}
        className={`tab-item${isActive ? ' active' : ''}${isSidebar ? ' sidebar' : ''}`}
        onClick={() => setTab(t.id)}
      >
        {t.icon}
        <span>{t.label}</span>
      </button>
    );
  };

  if (isSidebar) {
    return (
      <nav className="tabbar tabbar-sidebar" aria-label="主导航">
        <div role="tablist">
          {TABS.map(renderTab)}
        </div>
      </nav>
    );
  }

  const [first, second, ...rest] = TABS;

  return (
    <nav className="tabbar" aria-label="主导航">
      <div role="tablist" className="tabbar-tabs">
        {renderTab(first)}
        {renderTab(second)}
        {rest.map(renderTab)}
      </div>
      <button
        type="button"
        className="tab-add"
        aria-label="添加新资料"
        onClick={openModal}
      >
        <span className="tab-add-btn">
          <Icon.Plus />
        </span>
      </button>
    </nav>
  );
}
