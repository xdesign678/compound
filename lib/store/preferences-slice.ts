import type { StateCreator } from 'zustand';
import type { AppState } from './types';
import type { HomeStyle, ColorMode, FontSize, LineHeight } from './ui-slice';
import { FONT_SIZE_MAP, LINE_HEIGHT_MAP } from './ui-slice';
import { DEFAULT_LOCALE, type Locale } from '../i18n/dict';
import { parseJson } from '../utils';

const RECENT_COMMAND_ITEMS_KEY = 'compound_recent_command_items';
const MAX_RECENT_COMMAND_ITEMS = 10;

export type RecentCommandItemKind = 'concept' | 'source';

export interface RecentCommandItem {
  kind: RecentCommandItemKind;
  id: string;
  title: string;
  at: number;
}

function readStoredHomeStyle(): HomeStyle {
  if (typeof window === 'undefined') return 'library';
  const raw = localStorage.getItem('compound_home_style');
  return raw === 'feed' ? 'feed' : 'library';
}

function readStoredColorMode(): ColorMode {
  if (typeof window === 'undefined') return 'light';
  const raw = localStorage.getItem('compound_theme');
  return raw === 'dark' || raw === 'system' ? raw : 'light';
}

function readStoredFontSize(): FontSize {
  if (typeof window === 'undefined') return 'md';
  const raw = localStorage.getItem('compound_font_size');
  if (raw && raw in FONT_SIZE_MAP) return raw as FontSize;
  return 'md';
}

function readStoredLineHeight(): LineHeight {
  if (typeof window === 'undefined') return 'standard';
  const raw = localStorage.getItem('compound_line_height');
  if (raw && raw in LINE_HEIGHT_MAP) return raw as LineHeight;
  return 'standard';
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  return localStorage.getItem('compound_locale') === 'en' ? 'en' : DEFAULT_LOCALE;
}

function readStoredRecentItems(): RecentCommandItem[] {
  if (typeof window === 'undefined') return [];
  const parsed = parseJson<unknown>(localStorage.getItem(RECENT_COMMAND_ITEMS_KEY), []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentCommandItem).slice(0, MAX_RECENT_COMMAND_ITEMS);
}

function isRecentCommandItem(value: unknown): value is RecentCommandItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentCommandItem>;
  return (
    (item.kind === 'concept' || item.kind === 'source') &&
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.at === 'number'
  );
}

export function mergeRecentCommandItem(
  current: RecentCommandItem[],
  next: RecentCommandItem,
): RecentCommandItem[] {
  return [
    next,
    ...current.filter((item) => !(item.kind === next.kind && item.id === next.id)),
  ].slice(0, MAX_RECENT_COMMAND_ITEMS);
}

function applyColorMode(mode: ColorMode) {
  if (typeof window === 'undefined') return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    mode === 'dark' || (mode === 'system' && prefersDark),
  );
}

function applyFontSize(size: FontSize) {
  if (typeof window === 'undefined') return;
  const px = FONT_SIZE_MAP[size].px;
  document.documentElement.style.setProperty('--prose-font-size', `${px}px`);
}

function applyLineHeight(lh: LineHeight) {
  if (typeof window === 'undefined') return;
  const val = LINE_HEIGHT_MAP[lh].value;
  document.documentElement.style.setProperty('--prose-line-height', String(val));
}

function applySizeLineHeightLinkage(size: FontSize, lh: LineHeight) {
  if (typeof window === 'undefined') return;
  const px = FONT_SIZE_MAP[size].px;
  const ratio = LINE_HEIGHT_MAP[lh].value;
  const minRatio = px >= 18 ? 1.6 : px >= 16 ? 1.5 : 1.4;
  const effective = Math.max(ratio, minRatio);
  document.documentElement.style.setProperty('--prose-line-height', String(effective));
}

export interface PreferencesSlice {
  homeStyle: HomeStyle;
  colorMode: ColorMode;
  fontSize: FontSize;
  lineHeight: LineHeight;
  locale: Locale;
  recentItems: RecentCommandItem[];

  setHomeStyle: (s: HomeStyle) => void;
  hydrateHomeStyle: () => void;
  setColorMode: (mode: ColorMode) => void;
  hydrateColorMode: () => void;
  setFontSize: (size: FontSize) => void;
  hydrateFontSize: () => void;
  setLineHeight: (lh: LineHeight) => void;
  hydrateLineHeight: () => void;
  setLocale: (locale: Locale) => void;
  hydrateLocale: () => void;
  rememberRecentItem: (item: Omit<RecentCommandItem, 'at'> & { at?: number }) => void;
  hydrateRecentItems: () => void;
}

export const createPreferencesSlice: StateCreator<AppState, [], [], PreferencesSlice> = (
  set,
  get,
) => ({
  homeStyle: readStoredHomeStyle(),
  colorMode: 'light',
  fontSize: 'md',
  lineHeight: 'standard',
  locale: readStoredLocale(),
  recentItems: readStoredRecentItems(),

  setHomeStyle: (s) => {
    localStorage.setItem('compound_home_style', s);
    set({ homeStyle: s });
  },
  hydrateHomeStyle: () => set({ homeStyle: readStoredHomeStyle() }),
  setColorMode: (mode) => {
    localStorage.setItem('compound_theme', mode);
    applyColorMode(mode);
    set({ colorMode: mode });
  },
  hydrateColorMode: () => {
    const mode = readStoredColorMode();
    applyColorMode(mode);
    set({ colorMode: mode });
  },
  setFontSize: (size) => {
    localStorage.setItem('compound_font_size', size);
    applyFontSize(size);
    const lh = get().lineHeight;
    applySizeLineHeightLinkage(size, lh);
    set({ fontSize: size });
  },
  hydrateFontSize: () => {
    const size = readStoredFontSize();
    applyFontSize(size);
    set({ fontSize: size });
  },
  setLineHeight: (lh) => {
    localStorage.setItem('compound_line_height', lh);
    const size = get().fontSize;
    applySizeLineHeightLinkage(size, lh);
    set({ lineHeight: lh });
  },
  hydrateLineHeight: () => {
    const lh = readStoredLineHeight();
    applyLineHeight(lh);
    set({ lineHeight: lh });
  },
  setLocale: (locale) => {
    localStorage.setItem('compound_locale', locale);
    set({ locale });
  },
  hydrateLocale: () => set({ locale: readStoredLocale() }),
  rememberRecentItem: (item) => {
    const nextItem: RecentCommandItem = {
      ...item,
      title: item.title.trim(),
      at: item.at ?? Date.now(),
    };
    if (!nextItem.title) return;
    const recentItems = mergeRecentCommandItem(get().recentItems, nextItem);
    localStorage.setItem(RECENT_COMMAND_ITEMS_KEY, JSON.stringify(recentItems));
    set({ recentItems });
  },
  hydrateRecentItems: () => set({ recentItems: readStoredRecentItems() }),
});
