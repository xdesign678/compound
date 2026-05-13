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

      // Cmd/Ctrl+K should work even when focus is inside search or another text field.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        store.openCommandPalette();
        return;
      }

      // Don't intercept when typing in inputs (except Escape)
      if (isInput && e.key !== 'Escape') return;

      // Escape: layered close (command palette > modals > detail > no-op)
      if (e.key === 'Escape') {
        if (store.commandPaletteOpen) {
          e.preventDefault();
          store.closeCommandPalette();
        } else if (store.modalOpen) {
          e.preventDefault();
          store.closeModal();
        } else if (store.settingsOpen) {
          e.preventDefault();
          store.closeSettings();
        } else if (store.obsidianImportOpen) {
          e.preventDefault();
          store.closeObsidianImport();
        } else if (store.githubSyncOpen) {
          e.preventDefault();
          store.closeGithubSync();
        } else if (store.detail) {
          e.preventDefault();
          store.back();
        }
        // If nothing is open, do nothing
        return;
      }

      // Don't intercept other keys when any modal/drawer is open
      if (
        store.modalOpen ||
        store.settingsOpen ||
        store.obsidianImportOpen ||
        store.githubSyncOpen ||
        store.commandPaletteOpen
      ) {
        return;
      }

      // If detail is open, skip single-key shortcuts (except Escape)
      if (store.detail) return;

      // / : open command palette (search)
      if (e.key === '/') {
        e.preventDefault();
        store.openCommandPalette();
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
        // Delay event so CommandPalette mounts & effects run before dispatch
        setTimeout(() => window.dispatchEvent(new CustomEvent('command-palette-help')), 0);
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
