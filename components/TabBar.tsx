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
  const isSidebar = variant === 'sidebar';

  return (
    <nav className={`tabbar${isSidebar ? ' tabbar-sidebar' : ''}`} aria-label="主导航">
      {TABS.map((t) => {
        const isActive = tab === t.id;
        return (
          <button
            key={t.id}
            aria-current={isActive ? 'page' : undefined}
            className={`tab-item${isActive ? ' active' : ''}${isSidebar ? ' sidebar' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
