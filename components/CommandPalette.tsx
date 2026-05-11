'use client';

import { useState, useEffect, useRef, useDeferredValue, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore, type TabId } from '@/lib/store';
import { scoreCommandMatch } from '@/lib/utils';
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
  const recentItems = useAppStore((s) => s.recentItems);
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
      if (!q) return [];
      const byTitle = await db.concepts.where('title').startsWithIgnoreCase(q).limit(30).toArray();
      const byTitleIds = new Set(byTitle.map((c) => c.id));
      const byScan = await db.concepts
        .filter(
          (c) =>
            !byTitleIds.has(c.id) &&
            (c.title.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q)),
        )
        .limit(20)
        .toArray();
      const byRecent = await db.concepts.orderBy('updatedAt').reverse().limit(80).toArray();
      const candidates = new Map([...byTitle, ...byScan, ...byRecent].map((c) => [c.id, c]));
      return Array.from(candidates.values()).slice(0, 100);
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
      const byTitle = await db.sources.where('title').startsWithIgnoreCase(q).limit(10).toArray();
      const byTitleIds = new Set(byTitle.map((s) => s.id));
      const byScan = await db.sources
        .filter((s) => !byTitleIds.has(s.id) && s.title.toLowerCase().includes(q))
        .limit(20)
        .toArray();
      const byRecent = await db.sources.orderBy('updatedAt').reverse().limit(40).toArray();
      const candidates = new Map([...byTitle, ...byScan, ...byRecent].map((s) => [s.id, s]));
      return Array.from(candidates.values()).slice(0, 60);
    },
    [open, deferredQuery],
    [],
  );

  const items = useMemo<CommandItem[]>(() => {
    const store = useAppStore;
    const q = deferredQuery.trim();

    if (!q) {
      return [
        ...recentItems.map<CommandItem>((item) => ({
          id: `recent-${item.kind}-${item.id}`,
          type: item.kind,
          label: item.title,
          sublabel: item.kind === 'concept' ? '最近访问 · 概念' : '最近访问 · 资料',
          action: () => {
            store.getState().closeCommandPalette();
            store.getState().rememberRecentItem({
              kind: item.kind,
              id: item.id,
              title: item.title,
            });
            if (item.kind === 'concept') {
              store.getState().openConcept(item.id);
            } else {
              store.getState().openSource(item.id);
            }
          },
        })),
        ...QUICK_ACTIONS.map<CommandItem>((a) => ({
          id: a.id,
          type: 'action',
          label: a.label,
          icon: a.icon,
          action: () => a.action(store),
        })),
      ];
    }

    const scoredItems: Array<{ item: CommandItem; score: number }> = [];

    for (const a of QUICK_ACTIONS) {
      const score = scoreCommandMatch(q, a.label);
      if (score <= 0) continue;
      scoredItems.push({
        score,
        item: {
          id: a.id,
          type: 'action',
          label: a.label,
          icon: a.icon,
          action: () => a.action(store),
        },
      });
    }

    for (const c of concepts ?? []) {
      const score = scoreCommandMatch(q, c.title, c.summary);
      if (score <= 0) continue;
      scoredItems.push({
        score,
        item: {
          id: `concept-${c.id}`,
          type: 'concept',
          label: c.title,
          sublabel: c.summary.slice(0, 60),
          action: () => {
            store.getState().closeCommandPalette();
            store.getState().rememberRecentItem({ kind: 'concept', id: c.id, title: c.title });
            store.getState().openConcept(c.id);
          },
        },
      });
    }

    for (const s of sources ?? []) {
      const score = scoreCommandMatch(q, s.title, s.type);
      if (score <= 0) continue;
      scoredItems.push({
        score,
        item: {
          id: `source-${s.id}`,
          type: 'source',
          label: s.title,
          sublabel: s.type,
          action: () => {
            store.getState().closeCommandPalette();
            store.getState().rememberRecentItem({ kind: 'source', id: s.id, title: s.title });
            store.getState().openSource(s.id);
          },
        },
      });
    }

    return scoredItems
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .slice(0, 40)
      .map(({ item }) => item);
  }, [deferredQuery, recentItems, concepts, sources]);

  // Clamp selectedIndex when items change (prevents out-of-bounds from useDeferredValue lag)
  const clampedIndex = items.length === 0 ? 0 : Math.min(selectedIndex, items.length - 1);
  if (clampedIndex !== selectedIndex) {
    // Sync state if clamping was needed (will re-render)
    // Using a ref check to avoid infinite loop
    setSelectedIndex(clampedIndex);
  }

  const activeItemId =
    !showHelp && items[clampedIndex] ? `cmd-item-${items[clampedIndex].id}` : undefined;

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredQuery, items.length]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setShowHelp(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Listen for help mode event from keyboard shortcuts
  useEffect(() => {
    function onHelpEvent() {
      setShowHelp(true);
    }
    window.addEventListener('command-palette-help', onHelpEvent);
    return () => window.removeEventListener('command-palette-help', onHelpEvent);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const idx = items.length === 0 ? -1 : Math.min(selectedIndex, items.length - 1);
    if (idx < 0) return;
    const selected = el.children[idx] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, items.length]);

  function handleClose() {
    closeCommandPalette();
  }

  function handleSelect(index: number) {
    if (index < 0 || index >= items.length) return;
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
      setSelectedIndex((i) => (items.length === 0 ? 0 : Math.min(i + 1, items.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setSelectedIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setSelectedIndex(items.length === 0 ? 0 : items.length - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length > 0) {
        handleSelect(Math.min(selectedIndex, items.length - 1));
      }
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
          <span className="cmd-input-icon" aria-hidden="true">
            <Icon.Search />
          </span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="搜索概念、资料或输入命令…"
            aria-label="搜索命令、概念或资料"
            aria-autocomplete="list"
            aria-controls={showHelp ? undefined : 'cmd-results'}
            aria-activedescendant={activeItemId}
            aria-expanded={!showHelp}
            role="combobox"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-esc">Esc</kbd>
        </div>

        {showHelp ? (
          <div className="cmd-help" ref={listRef} role="list" aria-label="快捷键帮助">
            {HELP_ITEMS.map((h) => (
              <div key={h.keys} className="cmd-help-row" role="listitem">
                <kbd className="cmd-help-key">{h.keys}</kbd>
                <span className="cmd-help-desc">{h.desc}</span>
              </div>
            ))}
          </div>
        ) : (
          <div
            className="cmd-list"
            ref={listRef}
            id="cmd-results"
            role="listbox"
            aria-label="命令结果"
          >
            {items.length === 0 && (
              <div className="cmd-empty" role="status">
                没有匹配结果
              </div>
            )}
            {items.map((item, i) => (
              <button
                key={item.id}
                id={`cmd-item-${item.id}`}
                className={`cmd-item${i === clampedIndex ? ' selected' : ''}`}
                onClick={() => handleSelect(i)}
                onMouseEnter={() => setSelectedIndex(i)}
                role="option"
                aria-selected={i === clampedIndex}
                type="button"
              >
                <span className="cmd-item-icon" aria-hidden="true">
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
          <button
            className="cmd-footer-btn"
            type="button"
            aria-expanded={showHelp}
            onClick={() => setShowHelp((v) => !v)}
          >
            {showHelp ? '返回搜索' : '快捷键 ?'}
          </button>
        </div>
      </div>
    </div>
  );
}
