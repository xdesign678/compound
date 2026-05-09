'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          registrations.forEach((registration) => {
            void registration.unregister();
          });
        })
        .catch(() => {
          // SW cleanup failure is non-fatal in local development.
        });
      return;
    }

    const buildId = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID || 'dev');
    const workerUrl = `/sw.js?buildId=${buildId}`;
    let reloadingForUpdate = false;

    const promptForUpdate = (worker: ServiceWorker) => {
      useAppStore.getState().showErrorToast(
        '有新版本可用',
        () => {
          worker.postMessage({ type: 'SKIP_WAITING' });
        },
        '刷新',
      );
    };

    navigator.serviceWorker
      .register(workerUrl, { scope: '/' })
      .then((reg) => {
        // 定期检查更新
        setInterval(() => reg.update(), 60 * 60 * 1000);

        if (reg.waiting && navigator.serviceWorker.controller) {
          promptForUpdate(reg.waiting);
        }

        // 监听新版本
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              promptForUpdate(newWorker);
            }
          });
        });

        // 监听 controller 变化
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloadingForUpdate) return;
          reloadingForUpdate = true;
          window.location.reload();
        });
      })
      .catch(() => {
        // SW registration failure is non-fatal
      });
  }, []);

  return null;
}
