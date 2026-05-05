'use client';

import { useEffect, useRef } from 'react';
import { useAppStore, type TabId } from '@/lib/store';

const G_KEY_TIMEOUT_MS = 600;

export function useKeyboardShortcuts() {
  const gKeyRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const store = useAppStore.getState();
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;

      // Don't intercept when typing in inputs (except Escape)
      if (isInput && e.key !== 'Escape') return;

      // Don't intercept when any modal/drawer is open
      if (
        store.modalOpen ||
        store.settingsOpen ||
        store.obsidianImportOpen ||
        store.githubSyncOpen ||
        store.commandPaletteOpen
      ) {
        // Escape closes the command palette
        if (e.key === 'Escape' && store.commandPaletteOpen) {
          e.preventDefault();
          store.closeCommandPalette();
        }
        return;
      }

      // Cmd/Ctrl+K: open command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        store.openCommandPalette();
        return;
      }

      // Escape: go back or close detail
      if (e.key === 'Escape') {
        if (store.detail) {
          e.preventDefault();
          store.back();
        }
        return;
      }

      // If detail is open, skip single-key shortcuts (except Escape)
      if (store.detail) return;

      // / : focus search
      if (e.key === '/') {
        e.preventDefault();
        store.triggerSearchFocus();
        return;
      }

      // n : new note
      if (e.key === 'n') {
        e.preventDefault();
        store.openModal();
        return;
      }

      // ? : show help (open command palette in help mode)
      if (e.key === '?') {
        e.preventDefault();
        store.openCommandPalette();
        return;
      }

      // g followed by w/s/a/h : switch tabs (vim-style)
      if (e.key === 'g') {
        const prev = gKeyRef.current;
        if (prev && Date.now() - prev.at < G_KEY_TIMEOUT_MS) {
          // Double g - ignore
          gKeyRef.current = null;
          return;
        }
        gKeyRef.current = { key: 'g', at: Date.now() };
        return;
      }

      // Check for g-<key> combo
      const gPrev = gKeyRef.current;
      if (gPrev && Date.now() - gPrev.at < G_KEY_TIMEOUT_MS) {
        let targetTab: TabId | null = null;
        if (e.key === 'w') targetTab = 'wiki';
        else if (e.key === 's') targetTab = 'sources';
        else if (e.key === 'a') targetTab = 'ask';
        else if (e.key === 'h') targetTab = 'activity';

        if (targetTab) {
          e.preventDefault();
          store.setTab(targetTab);
          gKeyRef.current = null;
          return;
        }
      }

      // Reset g-key if another key was pressed
      if (gKeyRef.current && e.key !== 'g') {
        gKeyRef.current = null;
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
