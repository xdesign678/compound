'use client';

import './toast.css';
import { useState } from 'react';
import { useAppStore, type ToastState } from '@/lib/store';
import { t, useLocale } from '@/lib/i18n';

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
      role={toast.isError ? 'alert' : 'status'}
      aria-live={toast.isError ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast.loading && <div className="spinner" aria-hidden="true" />}
      <span className="toast-text">{displayText}</span>
      {toast.isError && toast.retry && (
        <button
          className="toast-retry"
          onClick={() => void handleRetry()}
          disabled={retrying}
          type="button"
        >
          {retrying ? t('toast.retrying') : (toast.retryLabel ?? t('toast.retry'))}
        </button>
      )}
      {toast.isError && (
        <button
          className="toast-close"
          onClick={onDismiss}
          aria-label={t('toast.close')}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

export function Toast() {
  useLocale();
  const primaryToast = useAppStore((s) => s.toast);
  const toastQueue = useAppStore((s) => s.toastQueue);
  const isOnline = useAppStore((s) => s.isOnline);
  const pausedCount = useAppStore(
    (s) => s.tasks.filter((task) => task.status === 'paused-offline').length,
  );
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
      {!isOnline && (
        <div
          className="toast visible toast-error"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast-text">
            {pausedCount > 0
              ? t('toast.offlineWithTasks', { count: pausedCount })
              : t('toast.offline')}
          </span>
        </div>
      )}
      {/* Additional stacked toasts */}
      {additionalToasts.map((t) => (
        <ToastSlot key={t.id} toast={t} onDismiss={() => dismissQueueItem(t.id)} />
      ))}
      {/* Primary (most recent) toast */}
      <ToastSlot toast={primaryToast} onDismiss={hideToast} />
    </div>
  );
}
