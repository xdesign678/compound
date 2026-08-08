'use client';

import './activity-view.css';
import { useId, useRef, type KeyboardEvent } from 'react';
import { useAppStore, type ActivitySubTab } from '@/lib/store';
import { Icon } from '../Icons';
import { HealthView } from './HealthView';
import { ActivityLogView } from './ActivityLogView';

const TABS: { key: ActivitySubTab; label: string }[] = [
  { key: 'health', label: '健康' },
  { key: 'log', label: '日志' },
];

export function ActivityView() {
  const tabBaseId = useId();
  const subTab = useAppStore((s) => s.activitySubTab);
  const setSubTab = useAppStore((s) => s.setActivitySubTab);
  const lintBanner = useAppStore((s) => s.lintBanner);
  const activePanelId = `${tabBaseId}-panel-${subTab}`;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // WAI tablist 键盘漫游：←/→ 切换标签并移动焦点，配合 roving tabindex
  const handleTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = TABS.findIndex((t) => t.key === subTab);
    const nextIndex =
      (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    setSubTab(TABS[nextIndex].key);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <section className="activity-container" aria-label="Wiki 维护">
      {lintBanner && (
        <div
          className={`activity-inline-status tone-${lintBanner.tone}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="activity-inline-status-icon" aria-hidden="true">
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
      <div
        className="activity-subtabs"
        role="tablist"
        aria-label="活动视图"
        onKeyDown={handleTabListKeyDown}
      >
        {TABS.map((t, index) => (
          <button
            key={t.key}
            id={`${tabBaseId}-tab-${t.key}`}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={subTab === t.key}
            aria-controls={`${tabBaseId}-panel-${t.key}`}
            tabIndex={subTab === t.key ? 0 : -1}
            className={`subtab${subTab === t.key ? ' active' : ''}`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={`${tabBaseId}-tab-${subTab}`}
        tabIndex={-1}
      >
        {subTab === 'health' ? <HealthView /> : <ActivityLogView />}
      </div>
    </section>
  );
}
