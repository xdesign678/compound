'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

export function useOnlineStatus() {
  const setOnline = useAppStore((s) => s.setOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setOnline(navigator.onLine);

    const triggerSync = () => {
      import('@/lib/cloud-sync')
        .then((mod) => {
          mod.pullSnapshotFromCloud?.().catch(() => {});
        })
        .catch(() => {});
    };

    const onOnline = () => {
      setOnline(true);
      // 恢复在线时自动同步
      triggerSync();
    };
    const onOffline = () => setOnline(false);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        triggerSync();
      }
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [setOnline]);
}
