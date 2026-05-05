'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';

export function Toast() {
  const { visible, text, loading, isError, retry, retryLabel } = useAppStore((s) => s.toast);
  const hideToast = useAppStore((s) => s.hideToast);
  const [retrying, setRetrying] = useState(false);

  const displayText = isError && text.length > 200 ? text.slice(0, 200) + '…' : text;

  const handleRetry = async () => {
    if (!retry || retrying) return;
    setRetrying(true);
    hideToast();
    try {
      await retry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={`toast ${visible ? 'visible' : ''} ${isError ? 'toast-error' : ''}`}
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {loading && <div className="spinner" />}
      <span className="toast-text">{displayText}</span>
      {isError && retry && (
        <button
          className="toast-retry"
          onClick={() => void handleRetry()}
          disabled={retrying}
          type="button"
        >
          {retrying ? '重试中…' : (retryLabel ?? '重试')}
        </button>
      )}
      {isError && (
        <button className="toast-close" onClick={hideToast} aria-label="关闭">
          ×
        </button>
      )}
    </div>
  );
}
