'use client';

import { useAppStore, type ActivitySubTab } from '@/lib/store';
import { Icon } from '../Icons';
import { HealthView } from './HealthView';
import { ActivityLogView } from './ActivityLogView';

const TABS: { key: ActivitySubTab; label: string }[] = [
  { key: 'health', label: '健康' },
  { key: 'log', label: '日志' },
];

export function ActivityView() {
  const subTab = useAppStore((s) => s.activitySubTab);
  const setSubTab = useAppStore((s) => s.setActivitySubTab);
  const lintBanner = useAppStore((s) => s.lintBanner);

  return (
    <div className="activity-container">
      {lintBanner && (
        <div
          className={`activity-inline-status tone-${lintBanner.tone}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="activity-inline-status-icon">
            {lintBanner.tone === 'running' ? (
              <span className="lint-spinner" />
            ) : (
              <Icon.Contradiction />
            )}
          </div>
          <div className="activity-inline-status-body">
            <div className="activity-inline-status-title">{lintBanner.title}</div>
            <div className="activity-inline-status-details">{lintBanner.details}</div>
          </div>
        </div>
      )}
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
