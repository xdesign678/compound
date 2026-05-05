'use client';

import { useState } from 'react';
import { useAppStore, type ToastState } from '@/lib/store';

function ToastSlot({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const displayText =
    toast.isError && toast.text.length > 200 ? toast.text.slice(0, 200) + '…' : toast.text;

  const handleRetry = async () => {
    if (!toast.retry || retrying) return;
    setRetrying(true);
    onDismiss();
    try {
      await toast.retry();
    } finally {
      setRetrying(false);
    }
  };

  if (!toast.visible) return null;

  return (
    <div
      className={`toast ${toast.visible ? 'visible' : ''} ${toast.isError ? 'toast-error' : ''}`}
      role="status"
      aria-live={toast.isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast.loading && <div className="spinner" />}
      <span className="toast-text">{displayText}</span>
      {toast.isError && toast.retry && (
        <button
          className="toast-retry"
          onClick={() => void handleRetry()}
          disabled={retrying}
          type="button"
        >
          {retrying ? '重试中…' : (toast.retryLabel ?? '重试')}
        </button>
      )}
      {toast.isError && (
        <button className="toast-close" onClick={onDismiss} aria-label="关闭">
          ×
        </button>
      )}
    </div>
  );
}

export function Toast() {
  const primaryToast = useAppStore((s) => s.toast);
  const toastQueue = useAppStore((s) => s.toastQueue);
  const hideToast = useAppStore((s) => s.hideToast);

  const dismissQueueItem = (id: number) => {
    useAppStore.setState((s) => ({
      toastQueue: s.toastQueue.filter((t) => t.id !== id),
    }));
  };

  // Show primary toast + any additional queue items (excluding primary)
  const additionalToasts = toastQueue.filter((t) => t.id !== primaryToast.id && t.visible);

  return (
    <div className="toast-container">
      {/* Additional stacked toasts */}
      {additionalToasts.map((t) => (
        <ToastSlot key={t.id} toast={t} onDismiss={() => dismissQueueItem(t.id)} />
      ))}
      {/* Primary (most recent) toast */}
      <ToastSlot toast={primaryToast} onDismiss={hideToast} />
    </div>
  );
}
