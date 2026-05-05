'use client';

import { useAppStore } from '@/lib/store';

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline);

  if (isOnline) return null;

  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <span className="offline-banner-text">离线模式 · 仅本地查看</span>
      <span className="offline-banner-hint">写入操作（摄入 / 修复 / 归类）已暂停</span>
    </div>
  );
}
