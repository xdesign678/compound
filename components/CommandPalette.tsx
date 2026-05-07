'use client';

import { useState, useEffect, useRef, useDeferredValue, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore, type TabId } from '@/lib/store';
import { Icon } from './Icons';

interface CommandItem {
  id: string;
  type: 'concept' | 'source' | 'action';
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  action: () => void;
}

const QUICK_ACTIONS: Array<{
  id: string;
  label: string;
  icon: React.ReactNode;
  tab?: TabId;
  action: (store: typeof useAppStore) => void;
}> = [
  {
    id: 'new-note',
    label: '新建笔记',
    icon: <Icon.Plus />,
    action: (s) => {
      s.getState().closeCommandPalette();
      s.getState().openModal();
    },
  },
  {
    id: 'tab-wiki',
    label: '切换到 Wiki',
    icon: <Icon.Wiki />,
    tab: 'wiki',
    action: (s) => {
      s.getState().closeCommandPalette();
      s.getState().setTab('wiki');
    },
  },
  {
    id: 'tab-sources',
    label: '切换到资料',
    icon: <Icon.Sources />,
    tab: 'sources',
    action: (s) => {
      s.getState().closeCommandPalette();
      s.getState().setTab('sources');
    },
  },
  {
    id: 'tab-ask',
    label: '切换到问答',
    icon: <Icon.Ask />,
    tab: 'ask',
    action: (s) => {
      s.getState().closeCommandPalette();
      s.getState().setTab('ask');
    },
  },
  {
    id: 'tab-activity',
    label: '切换到活动',
    icon: <Icon.Activity />,
    tab: 'activity',
    action: (s) => {
      s.getState().closeCommandPalette();
      s.getState().setTab('activity');
    },
  },
  {
    id: 'settings',
    label: '打开设置',
    icon: <Icon.Settings />,
    action: (s) => {
      s.getState().closeCommandPalette();
      s.getState().openSettings();
    },
  },
];

const HELP_ITEMS = [
  { keys: '⌘K / Ctrl+K', desc: '打开命令面板' },
  { keys: '/', desc: '聚焦搜索' },
  { keys: 'g w', desc: '切换到 Wiki' },
  { keys: 'g s', desc: '切换到资料' },
  { keys: 'g a', desc: '切换到问答' },
  { keys: 'g h', desc: '切换到活动' },
  { keys: 'n', desc: '新建笔记' },
  { keys: '?', desc: '显示快捷键帮助' },
  { keys: 'Escape', desc: '关闭/返回' },
];

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const closeCommandPalette = useAppStore((s) => s.closeCommandPalette);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const concepts = useLiveQuery(
    async () => {
      if (!open) return [];
      const q = deferredQuery.trim().toLowerCase();
      const db = getDb();
      if (!q) {
        return db.concepts.orderBy('updatedAt').reverse().limit(20).toArray();
      }
      // Use DB-side filtering with limit for better performance
      const byTitle = await db.concepts.where('title').startsWithIgnoreCase(q).limit(30).toArray();
      const byTitleIds = new Set(byTitle.map((c) => c.id));
      // Fallback: limited scan for substring matches not caught by startsWith
      const byScan = await db.concepts
        .filter(
          (c) =>
            !byTitleIds.has(c.id) &&
            (c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q)),
        )
        .limit(20)
        .toArray();
      return [...byTitle, ...byScan].slice(0, 20);
    },
    [open, deferredQuery],
    [],
  );

  const sources = useLiveQuery(
    async () => {
      if (!open) return [];
      const q = deferredQuery.trim().toLowerCase();
      const db = getDb();
      if (!q) return [];
      // Use DB-side filtering with limit for better performance
      const byTitle = await db.sources.where('title').startsWithIgnoreCase(q).limit(10).toArray();
      if (byTitle.length >= 10) return byTitle;
      const byTitleIds = new Set(byTitle.map((s) => s.id));
      const byScan = await db.sources
        .filter((s) => !byTitleIds.has(s.id) && s.title.toLowerCase().includes(q))
        .limit(10 - byTitle.length)
        .toArray();
      return [...byTitle, ...byScan];
    },
    [open, deferredQuery],
    [],
  );

  const items = useMemo<CommandItem[]>(() => {
    const store = useAppStore;
    const result: CommandItem[] = [];

    // Quick actions when query is empty or matches
    const q = deferredQuery.trim().toLowerCase();
    const filteredActions = q
      ? QUICK_ACTIONS.filter((a) => a.label.toLowerCase().includes(q))
      : QUICK_ACTIONS;
    for (const a of filteredActions) {
      result.push({
        id: a.id,
        type: 'action',
        label: a.label,
        icon: a.icon,
        action: () => a.action(store),
      });
    }

    // Concepts
    for (const c of concepts ?? []) {
      result.push({
        id: `concept-${c.id}`,
        type: 'concept',
        label: c.title,
        sublabel: c.summary.slice(0, 60),
        action: () => {
          store.getState().closeCommandPalette();
          store.getState().openConcept(c.id);
        },
      });
    }

    // Sources
    for (const s of sources ?? []) {
      result.push({
        id: `source-${s.id}`,
        type: 'source',
        label: s.title,
        sublabel: s.type,
        action: () => {
          store.getState().closeCommandPalette();
          store.getState().openSource(s.id);
        },
      });
    }

    return result;
  }, [deferredQuery, concepts, sources]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredQuery]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setShowHelp(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const selected = el.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function handleClose() {
    closeCommandPalette();
  }

  function handleSelect(index: number) {
    const item = items[index];
    if (item) item.action();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSelect(selectedIndex);
      return;
    }
  }

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={handleClose}>
      <div
        className="cmd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmd-input-row">
          <Icon.Search />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="搜索概念、资料或输入命令…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-esc">Esc</kbd>
        </div>

        {showHelp ? (
          <div className="cmd-help" ref={listRef}>
            {HELP_ITEMS.map((h) => (
              <div key={h.keys} className="cmd-help-row">
                <kbd className="cmd-help-key">{h.keys}</kbd>
                <span className="cmd-help-desc">{h.desc}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cmd-list" ref={listRef}>
            {items.length === 0 && <div className="cmd-empty">没有匹配结果</div>}
            {items.map((item, i) => (
              <button
                key={item.id}
                className={`cmd-item${i === selectedIndex ? ' selected' : ''}`}
                onClick={() => handleSelect(i)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="cmd-item-icon">
                  {item.type === 'concept' && <Icon.Wiki />}
                  {item.type === 'source' && <Icon.Sources />}
                  {item.type === 'action' && item.icon}
                </span>
                <span className="cmd-item-label">{item.label}</span>
                {item.sublabel && <span className="cmd-item-sub">{item.sublabel}</span>}
                {item.type === 'concept' && <span className="cmd-item-type">概念</span>}
                {item.type === 'source' && <span className="cmd-item-type">资料</span>}
              </button>
            ))}
          </div>
        )}

        <div className="cmd-footer">
          <button className="cmd-footer-btn" onClick={() => setShowHelp((v) => !v)}>
            {showHelp ? '返回搜索' : '快捷键 ?'}
          </button>
        </div>
      </div>
    </div>
  );
}
