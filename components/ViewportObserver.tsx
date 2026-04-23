'use client';

import { useEffect } from 'react';

/**
 * Tracks the mobile soft-keyboard height via window.visualViewport and
 * measures the composer/input-bar height. Exposes CSS variables so modals,
 * fly-outs and the chat composer can stay above the keyboard and reserve
 * matching bottom padding:
 *
 *   --ask-kb-offset      soft-keyboard height in px (0 when hidden)
 *   --ask-input-height   current height of .ask-input-bar (used by messages)
 *
 * Also toggles `ask-kb-open` class on <html> when the keyboard is visible.
 */
export function ViewportObserver() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;

    const vv = window.visualViewport;
    const updateKb = () => {
      if (!vv) {
        root.style.setProperty('--ask-kb-offset', '0px');
        return;
      }
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--ask-kb-offset', `${offset}px`);
      root.classList.toggle('ask-kb-open', offset > 0);
    };
    updateKb();
    vv?.addEventListener('resize', updateKb);
    vv?.addEventListener('scroll', updateKb);

    let barObserver: ResizeObserver | null = null;
    let currentBar: HTMLElement | null = null;

    const measureBar = (el: HTMLElement | null) => {
      if (!el) {
        root.style.setProperty('--ask-input-height', '0px');
        return;
      }
      const h = el.offsetHeight;
      root.style.setProperty('--ask-input-height', `${h}px`);
    };

    const attachBar = () => {
      const el = document.querySelector<HTMLElement>('.ask-input-bar');
      if (el === currentBar) return;
      currentBar = el;
      barObserver?.disconnect();
      if (el && 'ResizeObserver' in window) {
        barObserver = new ResizeObserver(() => measureBar(el));
        barObserver.observe(el);
      }
      measureBar(el);
    };

    attachBar();
    const mutationObserver = new MutationObserver(() => attachBar());
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      vv?.removeEventListener('resize', updateKb);
      vv?.removeEventListener('scroll', updateKb);
      mutationObserver.disconnect();
      barObserver?.disconnect();
      root.style.removeProperty('--ask-kb-offset');
      root.style.removeProperty('--ask-input-height');
      root.classList.remove('ask-kb-open');
    };
  }, []);

  return null;
}
