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

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // 定期检查更新
        setInterval(() => reg.update(), 60 * 60 * 1000);

        // 监听新版本
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 新版本就绪，使用 Toast 提示用户更新
              useAppStore
                .getState()
                .showErrorToast('有新版本可用', () => window.location.reload(), '立即更新');
            }
          });
        });

        // 监听 controller 变化
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      })
      .catch(() => {
        // SW registration failure is non-fatal
      });
  }, []);

  return null;
}
