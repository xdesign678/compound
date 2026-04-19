'use client';

import { useAppStore } from '@/lib/store';

export function Toast() {
  const { visible, text, loading } = useAppStore((s) => s.toast);
  return (
    <div className={`toast ${visible ? 'visible' : ''}`} role="status" aria-live="polite" aria-atomic="true">
      {loading && <div className="spinner" />}
      <span>{text}</span>
    </div>
  );
}
