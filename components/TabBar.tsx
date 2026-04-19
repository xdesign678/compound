'use client';

import { useAppStore, type TabId } from '@/lib/store';
import { Icon } from './Icons';

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'wiki', label: 'Wiki', icon: <Icon.Wiki /> },
  { id: 'sources', label: '资料', icon: <Icon.Sources /> },
  { id: 'ask', label: '问答', icon: <Icon.Ask /> },
  { id: 'activity', label: '活动', icon: <Icon.Activity /> },
];

export function TabBar() {
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);

  return (
    <nav className="tabbar" role="tablist" aria-label="主导航">
      {TABS.map((t) => {
        const isActive = tab === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            className={`tab-item ${isActive ? 'active' : ''}`}
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
