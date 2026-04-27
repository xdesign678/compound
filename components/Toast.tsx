'use client';

import { useAppStore } from '@/lib/store';

export function Toast() {
  const { visible, text, loading, isError } = useAppStore((s) => s.toast);
  const hideToast = useAppStore((s) => s.hideToast);

  const displayText = isError && text.length > 200 ? text.slice(0, 200) + '…' : text;

  return (
    <div
      className={`toast ${visible ? 'visible' : ''} ${isError ? 'toast-error' : ''}`}
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {loading && <div className="spinner" />}
      <span className="toast-text">{displayText}</span>
      {isError && (
        <button className="toast-close" onClick={hideToast} aria-label="关闭">
          ×
        </button>
      )}
    </div>
  );
}
