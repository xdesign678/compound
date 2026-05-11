'use client';

import { Toast } from './Toast';

/**
 * Client component wrapper for Toast, used in layout.tsx (server component).
 * This makes Toast globally available on all pages.
 */
export function GlobalToast() {
  return <Toast />;
}
