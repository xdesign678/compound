'use client';

import { useAppStore, type ActivitySubTab } from '@/lib/store';
import { HealthView } from './HealthView';
import { ActivityLogView } from './ActivityLogView';

const TABS: { key: ActivitySubTab; label: string }[] = [
  { key: 'health', label: '健康' },
  { key: 'log', label: '日志' },
];

export function ActivityView() {
  const subTab = useAppStore((s) => s.activitySubTab);
  const setSubTab = useAppStore((s) => s.setActivitySubTab);

  return (
    <div className="activity-container">
      <div className="activity-subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`subtab${subTab === t.key ? ' active' : ''}`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'health' ? <HealthView /> : <ActivityLogView />}
    </div>
  );
}
