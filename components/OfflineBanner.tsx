'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';

const DISMISSED_KEY = 'compound:offline-banner-dismissed';

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  const [dismissed, setDismissed] = useState(false);

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

  if (isOnline || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {}
  };

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <span className="offline-banner-text">离线模式 · 仅本地查看</span>
      <span className="offline-banner-hint">写入操作（摄入 / 修复 / 归类）已暂停</span>
      <button
        type="button"
        className="offline-banner-close"
        onClick={handleDismiss}
        aria-label="关闭离线提示"
      >
        ✕
      </button>
    </div>
  );
}
