'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ListTree } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { t, useLocale } from '@/lib/i18n';
import { Icon } from './Icons';

interface HeaderProps {
  conceptCount: number;
  sourceCount: number;
  loading?: boolean;
}

function getTabMeta(tab: string, props: HeaderProps) {
  if (tab === 'sources') {
    return {
      title: t('header.sources.title'),
      subtitle: props.loading
        ? t('header.sources.subtitle.loading')
        : t('header.sources.subtitle.ready', { sourceCount: props.sourceCount }),
    };
  }
  if (tab === 'ask') {
    return { title: t('header.ask.title'), subtitle: t('header.ask.subtitle') };
  }
  if (tab === 'activity') {
    return { title: t('header.activity.title'), subtitle: t('header.activity.subtitle') };
  }
  return {
    title: t('header.wiki.title'),
    subtitle: props.loading
      ? t('header.wiki.subtitle.loading')
      : t('header.wiki.subtitle.ready', {
          conceptCount: props.conceptCount,
          sourceCount: props.sourceCount,
        }),
  };
}

function OverflowMenu({
  open,
  onClose,
  onGithubSync,
  onObsidianImport,
  onSettings,
}: {
  open: boolean;
  onClose: () => void;
  onGithubSync: () => void;
  onObsidianImport: () => void;
  onSettings: () => void;
}) {
  useLocale();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const itemCount = 4;

  useEffect(() => {
    if (!open) return;
    setFocusedIndex(-1);
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => (i + 1) % itemCount);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => (i - 1 + itemCount) % itemCount);
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[focusedIndex]?.focus();
  }, [open, focusedIndex]);

  if (!open) return null;

  return (
    <div
      className="overflow-menu"
      ref={menuRef}
      role="menu"
      aria-label={t('header.more')}
      id="header-overflow-menu"
    >
      <button
        type="button"
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          onGithubSync();
        }}
      >
        <span aria-hidden="true">
          <Icon.Github />
        </span>
        <span>{t('header.githubSync')}</span>
      </button>
      <Link
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        href="/sync"
        onClick={onClose}
      >
        <span aria-hidden="true">
          <Icon.Activity />
        </span>
        <span>{t('header.syncConsole')}</span>
      </Link>
      <button
        type="button"
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          onObsidianImport();
        }}
      >
        <span aria-hidden="true">
          <Icon.Ingest />
        </span>
        <span>{t('header.obsidianImport')}</span>
      </button>
      <button
        type="button"
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          onSettings();
        }}
      >
        <span aria-hidden="true">
          <Icon.Settings />
        </span>
        <span>{t('header.settings')}</span>
      </button>
    </div>
  );
}

export function Header(props: HeaderProps) {
  useLocale();
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const back = useAppStore((s) => s.back);
  const openSettings = useAppStore((s) => s.openSettings);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);
  const searchCollapsed = useAppStore((s) => s.searchCollapsed);
  const triggerSearchFocus = useAppStore((s) => s.triggerSearchFocus);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);

  const [overflowOpen, setOverflowOpen] = useState(false);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);

  const showSearchIcon = !detail && (tab === 'wiki' || tab === 'sources') && searchCollapsed;
  const handleExpandSearch = () => {
    const main = document.querySelector('.app-main') as HTMLElement | null;
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
    triggerSearchFocus();
  };
  const handleOpenSourceToc = () => {
    window.dispatchEvent(new CustomEvent('compound:open-source-toc'));
  };
  const handleOpenConceptToc = () => {
    window.dispatchEvent(new CustomEvent('compound:open-concept-toc'));
  };

  if (detail) {
    return (
      <header className="header detail-header">
        <button type="button" className="back-btn" onClick={back}>
          <span aria-hidden="true">
            <Icon.Back />
          </span>
          <span>{t('header.back')}</span>
        </button>
        {(detail.type === 'source' || detail.type === 'concept') && (
          <div className="header-actions detail-header-actions">
            <button
              type="button"
              className="icon-btn detail-toc-btn"
              onClick={detail.type === 'source' ? handleOpenSourceToc : handleOpenConceptToc}
              aria-label={t('header.toc')}
              title={t('header.toc')}
            >
              <span aria-hidden="true">
                <ListTree />
              </span>
            </button>
          </div>
        )}
      </header>
    );
  }

  const meta = getTabMeta(tab, props);
  return (
    <header className="header">
      <div className="header-copy">
        <div className="header-kicker">Compound</div>
        <div className="header-title">{meta.title}</div>
        <div className="header-subtitle">{meta.subtitle}</div>
      </div>
      <div className="header-actions">
        {showSearchIcon && (
          <button
            type="button"
            className="icon-btn header-search-btn is-visible"
            onClick={handleExpandSearch}
            aria-label={t('header.search.expand')}
          >
            <span aria-hidden="true">
              <Icon.Search />
            </span>
          </button>
        )}
        {/* Mobile: command palette trigger (visible when search icon is not shown) */}
        {!showSearchIcon && (
          <button
            type="button"
            className="icon-btn header-mobile-search-btn"
            onClick={openCommandPalette}
            aria-label={t('header.search')}
          >
            <span aria-hidden="true">
              <Icon.Search />
            </span>
          </button>
        )}
        {/* Desktop: show individual icons */}
        <button
          type="button"
          className="icon-btn header-desktop-action"
          onClick={openGithubSync}
          aria-label={t('header.githubSync')}
          title={t('header.githubSync')}
        >
          <span aria-hidden="true">
            <Icon.Github />
          </span>
        </button>
        <Link
          className="icon-btn header-desktop-action"
          href="/sync"
          aria-label={t('header.syncConsole')}
          title={t('header.syncConsole')}
        >
          <span aria-hidden="true">
            <Icon.Activity />
          </span>
        </Link>
        <button
          type="button"
          className="icon-btn header-desktop-action"
          onClick={openObsidianImport}
          aria-label={t('header.obsidianImport')}
          title={t('header.obsidianImport')}
        >
          <span aria-hidden="true">
            <Icon.Ingest />
          </span>
        </button>
        <button
          type="button"
          className="icon-btn header-desktop-action"
          onClick={openSettings}
          aria-label={t('header.settings')}
        >
          <span aria-hidden="true">
            <Icon.Settings />
          </span>
        </button>
        {/* Mobile: single overflow menu */}
        <div className="header-mobile-overflow">
          <button
            type="button"
            className={`icon-btn${overflowOpen ? ' is-active' : ''}`}
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label={t('header.more')}
            aria-expanded={overflowOpen}
            aria-haspopup="menu"
            aria-controls={overflowOpen ? 'header-overflow-menu' : undefined}
          >
            <span aria-hidden="true">
              <Icon.Overflow />
            </span>
          </button>
          <OverflowMenu
            open={overflowOpen}
            onClose={closeOverflow}
            onGithubSync={openGithubSync}
            onObsidianImport={openObsidianImport}
            onSettings={openSettings}
          />
        </div>
      </div>
    </header>
  );
}
