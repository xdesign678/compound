'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ListTree } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Icon } from './Icons';

interface HeaderProps {
  conceptCount: number;
  sourceCount: number;
}

const TAB_TITLES: Record<string, { t: string; s: (h: HeaderProps) => string }> = {
  wiki: {
    t: '我的 Wiki',
    s: (h) => `${h.conceptCount} 个概念 · ${h.sourceCount} 份资料`,
  },
  sources: {
    t: '原始资料',
    s: (h) => `${h.sourceCount} 份 · AI 只读不改`,
  },
  ask: {
    t: '向 Wiki 提问',
    s: () => '答案来自你的知识库',
  },
  activity: {
    t: 'Wiki 维护',
    s: () => '健康检查与活动日志',
  },
};

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
    <div className="overflow-menu" ref={menuRef} role="menu" aria-label="更多选项">
      <button
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          onGithubSync();
        }}
      >
        <Icon.Github />
        <span>从 GitHub 同步</span>
      </button>
      <Link
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        href="/sync"
        onClick={onClose}
      >
        <Icon.Activity />
        <span>同步控制台</span>
      </Link>
      <button
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          onObsidianImport();
        }}
      >
        <Icon.Ingest />
        <span>从 Obsidian 批量导入</span>
      </button>
      <button
        className="overflow-menu-item"
        role="menuitem"
        tabIndex={-1}
        onClick={() => {
          onClose();
          onSettings();
        }}
      >
        <Icon.Settings />
        <span>设置</span>
      </button>
    </div>
  );
}

export function Header(props: HeaderProps) {
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

  if (detail) {
    return (
      <header className="header detail-header">
        <button className="back-btn" onClick={back}>
          <Icon.Back />
          <span>返回</span>
        </button>
        {detail.type === 'source' && (
          <div className="header-actions detail-header-actions">
            <button
              type="button"
              className="icon-btn detail-toc-btn"
              onClick={handleOpenSourceToc}
              aria-label="显示目录"
              title="显示目录"
            >
              <ListTree />
            </button>
          </div>
        )}
      </header>
    );
  }

  const meta = TAB_TITLES[tab];
  return (
    <header className="header">
      <div className="header-copy">
        <div className="header-kicker">Compound</div>
        <div className="header-title">{meta.t}</div>
        <div className="header-subtitle">{meta.s(props)}</div>
      </div>
      <div className="header-actions">
        {showSearchIcon && (
          <button
            type="button"
            className="icon-btn header-search-btn is-visible"
            onClick={handleExpandSearch}
            aria-label="展开搜索"
          >
            <Icon.Search />
          </button>
        )}
        {/* Mobile: command palette trigger (visible when search icon is not shown) */}
        {!showSearchIcon && (
          <button
            type="button"
            className="icon-btn header-mobile-search-btn"
            onClick={openCommandPalette}
            aria-label="搜索"
          >
            <Icon.Search />
          </button>
        )}
        {/* Desktop: show individual icons */}
        <button
          className="icon-btn header-desktop-action"
          onClick={openGithubSync}
          aria-label="从 GitHub 同步"
          title="从 GitHub 同步 Obsidian 笔记"
        >
          <Icon.Github />
        </button>
        <Link
          className="icon-btn header-desktop-action"
          href="/sync"
          aria-label="同步控制台"
          title="同步控制台"
        >
          <Icon.Activity />
        </Link>
        <button
          className="icon-btn header-desktop-action"
          onClick={openObsidianImport}
          aria-label="从 Obsidian 批量导入"
          title="从本地 Obsidian 文件夹批量导入"
        >
          <Icon.Ingest />
        </button>
        <button className="icon-btn header-desktop-action" onClick={openSettings} aria-label="设置">
          <Icon.Settings />
        </button>
        {/* Mobile: single overflow menu */}
        <div className="header-mobile-overflow">
          <button
            className={`icon-btn${overflowOpen ? ' is-active' : ''}`}
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="更多操作"
            aria-expanded={overflowOpen}
          >
            <Icon.Overflow />
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
