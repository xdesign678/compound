'use client';

import './toast.css';
import { useEffect, useState } from 'react';
import { useAppStore, type ToastState } from '@/lib/store';
import { t, useLocale } from '@/lib/i18n';

// 与 --motion-slow 一致：收起动画时长，播完再卸载节点
const TOAST_EXIT_MS = 320;

function ToastSlot({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const [retrying, setRetrying] = useState(false);
  // visible 翻成 false 时不立即卸载，保留节点播完收起动画
  const [present, setPresent] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (toast.visible) {
      if (!present) {
        setPresent(true);
        return;
      }
      if (!shown) {
        // 先让节点以隐藏态挂载一帧，再加 visible 类触发滑入过渡
        let inner = 0;
        const outer = requestAnimationFrame(() => {
          inner = requestAnimationFrame(() => setShown(true));
        });
        return () => {
          cancelAnimationFrame(outer);
          cancelAnimationFrame(inner);
        };
      }
      return;
    }
    if (!present) return;
    setShown(false);
    const timer = window.setTimeout(() => setPresent(false), TOAST_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [toast.visible, present, shown]);

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

  if (!present) return null;

  return (
    <div
      className={`toast ${shown ? 'visible' : ''} ${toast.isError ? 'toast-error' : ''}`}
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
      <button
        className="toast-close"
        onClick={onDismiss}
        aria-label={t('toast.close')}
        type="button"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function Toast() {
  useLocale();
  const primaryToast = useAppStore((s) => s.toast);
  const toastQueue = useAppStore((s) => s.toastQueue);
  const hideToast = useAppStore((s) => s.hideToast);

  const dismissQueueItem = (id: number) => {
    // 先标记不可见让 ToastSlot 播收起动画，播完再从队列移除
    useAppStore.setState((s) => ({
      toastQueue: s.toastQueue.map((t) => (t.id === id ? { ...t, visible: false } : t)),
    }));
    window.setTimeout(() => {
      useAppStore.setState((s) => ({
        toastQueue: s.toastQueue.filter((t) => t.id !== id),
      }));
    }, TOAST_EXIT_MS);
  };

  // Show primary toast + any additional queue items (excluding primary)
  const additionalToasts = toastQueue.filter((t) => t.id !== primaryToast.id);

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
