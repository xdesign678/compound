'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

const OFFLINE_SINCE_KEY = 'compound:offline-since';

export function getOfflineSince(): number | null {
  if (typeof window === 'undefined') return null;
  const value = Number(window.localStorage.getItem(OFFLINE_SINCE_KEY) || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function useOnlineStatus() {
  const setOnline = useAppStore((s) => s.setOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (navigator.onLine) {
      window.localStorage.removeItem(OFFLINE_SINCE_KEY);
    } else if (!getOfflineSince()) {
      window.localStorage.setItem(OFFLINE_SINCE_KEY, String(Date.now()));
    }
    setOnline(navigator.onLine);

    const replayOutbox = () => {
      void import('@/lib/api-client')
        .then((mod) => mod.replayDurableIngestOutboxIfAuthorized())
        .catch(() => {});
    };

    const triggerSync = () => {
      import('@/lib/cloud-sync')
        .then((mod) => {
          mod.pullSnapshotFromCloud?.().catch(() => {});
        })
        .catch(() => {});
    };

    if (navigator.onLine) {
      replayOutbox();
    }

    const onOnline = () => {
      window.localStorage.removeItem(OFFLINE_SINCE_KEY);
      setOnline(true);
      void useAppStore.getState().replayPausedOfflineTasks();
      replayOutbox();
      triggerSync();
    };
    const onOffline = () => {
      if (!getOfflineSince()) {
        window.localStorage.setItem(OFFLINE_SINCE_KEY, String(Date.now()));
      }
      setOnline(false);
    };

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
