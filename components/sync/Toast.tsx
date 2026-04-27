'use client';

import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warn';

interface ToastEntry {
  id: number;
  tone: ToastTone;
  text: string;
  detail?: string;
}

interface ToastContextValue {
  push: (tone: ToastTone, text: string, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const push = useCallback((tone: ToastTone, text: string, detail?: string) => {
    toastId += 1;
    const id = toastId;
    setToasts((prev) => [...prev, { id, tone, text, detail }]);
    window.setTimeout(
      () => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      },
      tone === 'error' ? 8000 : 4500,
    );
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`ops-toast tone-${t.tone}`}>
            <strong>{t.text}</strong>
            {t.detail ? <span>{t.detail}</span> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: (tone, text, detail) => {
        // Fallback when provider is missing — never silent.
        const prefix = tone === 'error' ? '[ERROR]' : tone === 'warn' ? '[WARN]' : '[INFO]';
        // eslint-disable-next-line no-console
        console.log(prefix, text, detail || '');
      },
    };
  }
  return ctx;
}

/**
 * Render once on mount — used by SyncDashboard so the rest of the page can
 * call `useToast()` without rendering its own provider boundary every render.
 * Equivalent to `<ToastProvider>` but doesn't add any wrapper element.
 */
export function ToastSlot() {
  // The provider above handles rendering; this component is a no-op marker
  // we kept just in case future callers want a sentinel.
  useEffect(() => {}, []);
  return null;
}
