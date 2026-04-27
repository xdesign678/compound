'use client';

import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { GeneralTab } from './settings/GeneralTab';
import { ModelTab } from './settings/ModelTab';
import { DataTab } from './settings/DataTab';

export type SettingsTabId = 'general' | 'model' | 'data';

const TABS: { id: SettingsTabId; label: string; icon: string }[] = [
  { id: 'general', label: '通用', icon: '🎨' },
  { id: 'model', label: '模型', icon: '✨' },
  { id: 'data', label: '数据', icon: '🗄️' },
];

export function SettingsDrawer() {
  const isOpen = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);
  const hydrateColorMode = useAppStore((s) => s.hydrateColorMode);

  const [activeTab, setActiveTab] = useState<SettingsTabId>('general');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hydrateColorMode();
  }, [hydrateColorMode]);

  useEffect(() => {
    const el = modalRef.current;
    if (!el || !isOpen) return;
    el.focus({ preventScroll: true });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  return (
    <div className={`modal-overlay ${isOpen ? 'visible' : ''}`} onClick={close}>
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
            <div className="settings-kicker">Compound 设置</div>
            <h3 id="settings-drawer-title">设置</h3>
          </div>
          <button className="settings-close-btn" onClick={close} aria-label="关闭设置">
            关闭
          </button>
        </div>

        {/* 响应式导航 + 内容 */}
        <div className="settings-layout">
          {/* 桌面端侧栏导航（≥768px 显示） */}
          <nav className="settings-sidebar" role="tablist" aria-label="设置分类">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`settings-sidebar-item${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-sidebar-icon">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="settings-main">
            {/* 移动端分段控制（<768px 显示） */}
            <div className="settings-mobile-tabs">
              <div className="settings-segmented settings-segmented-three">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    className={activeTab === tab.id ? 'active' : ''}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
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
