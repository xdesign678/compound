'use client';

import './offline-banner.css';
import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { t, useLocale } from '@/lib/i18n';

const DISMISSED_KEY = 'compound:offline-banner-dismissed';

export function OfflineBanner() {
  useLocale();
  const isOnline = useAppStore((s) => s.isOnline);
  const [dismissed, setDismissed] = useState(false);
  const active = !isOnline && !dismissed;

  useEffect(() => {
    // Reset dismissed state when coming back online
    if (isOnline) {
      try {
        sessionStorage.removeItem(DISMISSED_KEY);
      } catch {}
      setDismissed(false);
    } else {
      // Check if previously dismissed this session
      try {
        if (sessionStorage.getItem(DISMISSED_KEY) === '1') {
          setDismissed(true);
        }
      } catch {}
    }
  }, [isOnline]);

  // banner 固定定位，占位通过根类名驱动（--offline-banner-height 推高 app-shell、叠加 toast top）
  useEffect(() => {
    document.documentElement.classList.toggle('has-offline-banner', active);
    return () => {
      document.documentElement.classList.remove('has-offline-banner');
    };
  }, [active]);

  if (!active) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {}
  };

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <span className="offline-banner-text">{t('offlineBanner.text')}</span>
      <span className="offline-banner-hint">{t('offlineBanner.hint')}</span>
      <button
        type="button"
        className="offline-banner-close"
        onClick={handleDismiss}
        aria-label={t('offlineBanner.close')}
      >
        ✕
      </button>
    </div>
  );
}
