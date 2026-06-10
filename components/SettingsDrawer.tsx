'use client';

import '@/components/modals.css';
import '@/app/modals.css';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useAppStore } from '@/lib/store';
import { t, useLocale, type I18nKey } from '@/lib/i18n';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { GeneralTab } from './settings/GeneralTab';
import { ModelTab } from './settings/ModelTab';
import { DataTab } from './settings/DataTab';

export type SettingsTabId = 'general' | 'model' | 'data';

function IconGeneral() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconModel() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <path
        d="M12 2l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5L4.5 9.5l5.5-2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconData() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

const TABS: { id: SettingsTabId; labelKey: I18nKey; icon: () => ReactNode }[] = [
  { id: 'general', labelKey: 'settings.general', icon: IconGeneral },
  { id: 'model', labelKey: 'settings.model', icon: IconModel },
  { id: 'data', labelKey: 'settings.data', icon: IconData },
];

export function SettingsDrawer() {
  useLocale();
  const isOpen = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const hydrateColorMode = useAppStore((s) => s.hydrateColorMode);
  const hydrateLocale = useAppStore((s) => s.hydrateLocale);

  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
  const [visible, setVisible] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
    }
  }, [isOpen]);

  useEffect(() => {
    hydrateColorMode();
    hydrateLocale();
  }, [hydrateColorMode, hydrateLocale]);

  useFocusTrap(modalRef, isOpen);

  useEffect(() => {
    const el = modalRef.current;
    if (!el || !isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  return (
    <div className={`modal-overlay${visible ? ' visible' : ''}`} onClick={close}>
      <div
        className="modal settings-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-drawer-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-handle" />

        {/* Header */}
        <div className="settings-hero">
          <div>
            <div className="settings-kicker">{t('settings.kicker')}</div>
            <h3 id="settings-drawer-title">{t('settings.title')}</h3>
          </div>
          <button className="settings-close-btn" onClick={close} aria-label={t('settings.close')}>
            {t('settings.close')}
          </button>
        </div>

        {/* 响应式导航 + 内容 */}
        <div className="settings-layout">
          {/* 桌面端侧栏导航（≥768px 显示） */}
          <nav className="settings-sidebar" role="tablist" aria-label={t('settings.categories')}>
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`settings-sidebar-item${activeTab === tab.id ? ' active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="settings-sidebar-icon">
                    <TabIcon />
                  </span>
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </nav>

          <div className="settings-main">
            {/* 移动端分段控制（<768px 显示） */}
            <div className="settings-mobile-tabs">
              <div
                className="settings-segmented settings-segmented-three"
                role="tablist"
                aria-label={t('settings.categories')}
              >
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={activeTab === tab.id ? 'active' : ''}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab 内容 */}
            <div className="settings-panel">
              {activeTab === 'general' && <GeneralTab />}
              {activeTab === 'model' && <ModelTab />}
              {activeTab === 'data' && <DataTab onCloseAction={close} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
