export const APP_HISTORY_VERSION = 1;
export const APP_HISTORY_OWNER = 'compound';
export const APP_HISTORY_KEY = '__compoundHistory';

export const APP_HISTORY_TABS = ['wiki', 'sources', 'ask', 'activity'] as const;
export type AppHistoryTab = (typeof APP_HISTORY_TABS)[number];

export const APP_HISTORY_DETAIL_KINDS = ['concept', 'source', 'category'] as const;
export type AppHistoryDetailKind = (typeof APP_HISTORY_DETAIL_KINDS)[number];

export interface AppHistoryCategoryLocator {
  primary: string;
  secondary: string;
}

export interface AppHistoryDetail {
  kind: AppHistoryDetailKind;
  id: string;
  category?: AppHistoryCategoryLocator;
}

export const MAX_DETAIL_CHAIN_DEPTH = 32;

export interface AppHistoryState {
  v: typeof APP_HISTORY_VERSION;
  owner: typeof APP_HISTORY_OWNER;
  tab: AppHistoryTab;
  detail?: AppHistoryDetail;
  pushedFromApp?: boolean;
  depth?: number;
}

export interface AppHistoryStoreDetail {
  type: 'concept' | 'source' | 'category-wiki';
  id: string;
  primary?: string;
  secondary?: string;
}

export type AppHistoryCloseMode = 'back' | 'replace';

export interface AppHistoryUiPatch {
  tab?: AppHistoryTab;
  detail: AppHistoryStoreDetail | null;
}

const TAB_SET = new Set<string>(APP_HISTORY_TABS);
const KIND_SET = new Set<string>(APP_HISTORY_DETAIL_KINDS);

let hydrating = false;
let pendingTabCollapse: AppHistoryTab | null = null;

export function withAppHistoryHydration(run: () => void): void {
  hydrating = true;
  try {
    run();
  } finally {
    hydrating = false;
  }
}

export function isAppHistoryTab(value: unknown): value is AppHistoryTab {
  return typeof value === 'string' && TAB_SET.has(value);
}

export function parseAppHistoryState(raw: unknown): AppHistoryState | null {
  const candidate = extractCandidate(raw);
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  if (record.v !== APP_HISTORY_VERSION) return null;
  if (record.owner !== APP_HISTORY_OWNER) return null;
  if (!isAppHistoryTab(record.tab)) return null;

  let pushedFromApp: boolean | undefined;
  if ('pushedFromApp' in record) {
    if (record.pushedFromApp !== true && record.pushedFromApp !== false) return null;
    pushedFromApp = record.pushedFromApp;
  }

  const hasDetail = 'detail' in record && record.detail !== undefined;
  let depth: number | undefined;
  if ('depth' in record) {
    if (!isSafeDepth(record.depth, hasDetail)) return null;
    depth = record.depth;
  }

  if (!hasDetail) {
    return {
      v: APP_HISTORY_VERSION,
      owner: APP_HISTORY_OWNER,
      tab: record.tab,
      ...(pushedFromApp !== undefined ? { pushedFromApp } : {}),
      ...(depth !== undefined ? { depth } : {}),
    };
  }

  const detail = parseDetail(record.detail);
  if (!detail) return null;
  return {
    v: APP_HISTORY_VERSION,
    owner: APP_HISTORY_OWNER,
    tab: record.tab,
    detail,
    ...(pushedFromApp !== undefined ? { pushedFromApp } : {}),
    ...(depth !== undefined ? { depth } : {}),
  };
}

export function readCurrentAppHistoryState(): AppHistoryState | null {
  if (typeof window === 'undefined') return null;
  return parseAppHistoryState(window.history.state);
}

export function createShellHistoryState(tab: AppHistoryTab): AppHistoryState {
  return {
    v: APP_HISTORY_VERSION,
    owner: APP_HISTORY_OWNER,
    tab,
  };
}

export function createDetailHistoryState(
  tab: AppHistoryTab,
  detail: AppHistoryDetail,
  pushedFromApp = false,
  depth = 1,
): AppHistoryState {
  return {
    v: APP_HISTORY_VERSION,
    owner: APP_HISTORY_OWNER,
    tab,
    detail,
    pushedFromApp,
    depth: clampDetailDepth(depth),
  };
}

export function toStoreDetail(detail: AppHistoryDetail): AppHistoryStoreDetail {
  if (detail.kind === 'concept') return { type: 'concept', id: detail.id };
  if (detail.kind === 'source') return { type: 'source', id: detail.id };
  const primary = detail.category?.primary ?? '';
  const secondary = detail.category?.secondary ?? '';
  return {
    type: 'category-wiki',
    id: `category-wiki:${primary}/${secondary}`,
    primary,
    secondary,
  };
}

export function fromStoreDetail(detail: AppHistoryStoreDetail): AppHistoryDetail | null {
  if (detail.type === 'concept') {
    return isNonEmptyString(detail.id) ? { kind: 'concept', id: detail.id } : null;
  }
  if (detail.type === 'source') {
    return isNonEmptyString(detail.id) ? { kind: 'source', id: detail.id } : null;
  }
  if (!isNonEmptyString(detail.primary) || !isNonEmptyString(detail.secondary)) return null;
  return {
    kind: 'category',
    id: `category-wiki:${detail.primary}/${detail.secondary}`,
    category: { primary: detail.primary, secondary: detail.secondary },
  };
}

export function hydrateUiFromHistoryState(raw: unknown): AppHistoryUiPatch {
  const parsed = parseAppHistoryState(raw);
  if (!parsed) return { detail: null };
  return {
    tab: parsed.tab,
    detail: parsed.detail ? toStoreDetail(parsed.detail) : null,
  };
}

export function canSafelyGoBack(raw: unknown = readHistoryState()): boolean {
  if (!isAppShellLocation()) return false;
  const parsed = parseAppHistoryState(raw);
  return Boolean(parsed?.detail && parsed.pushedFromApp === true);
}

export function establishAppHistoryShell(tab: AppHistoryTab): AppHistoryState {
  pendingTabCollapse = null;
  const existing = readCurrentAppHistoryState();
  if (existing) return existing;
  const shell = createShellHistoryState(tab);
  writeHistoryState(shell, 'replace');
  return shell;
}

export function replaceAppHistoryTab(tab: AppHistoryTab): void {
  if (hydrating) return;
  if (pendingTabCollapse) {
    pendingTabCollapse = tab;
    return;
  }
  const current = readCurrentAppHistoryState();
  const depth = current ? detailChainDepth(current) : 0;
  if (depth > 0 && current?.pushedFromApp === true && isAppShellLocation()) {
    pendingTabCollapse = tab;
    // Depth is the number of app-owned details above the shell, capped so
    // collapse cannot walk past that shell into an external predecessor.
    window.history.go(-depth);
    return;
  }
  writeHistoryState(createShellHistoryState(tab), 'replace');
}

export function finalizeAppHistoryTabCollapse(): boolean {
  if (!pendingTabCollapse) return false;
  const tab = pendingTabCollapse;
  pendingTabCollapse = null;
  writeHistoryState(createShellHistoryState(tab), 'push');
  return true;
}

export function isAppHistoryTabCollapsePending(): boolean {
  return pendingTabCollapse !== null;
}

export function pushAppHistoryDetail(tab: AppHistoryTab, detail: AppHistoryDetail): void {
  if (hydrating) return;
  const current = ensureAppHistoryEstablished(tab);
  if (current.tab === tab && detailsEqual(current.detail, detail)) return;
  const currentDepth = current.detail ? detailChainDepth(current) : 0;
  if (currentDepth >= MAX_DETAIL_CHAIN_DEPTH) {
    writeHistoryState(
      createDetailHistoryState(tab, detail, true, MAX_DETAIL_CHAIN_DEPTH),
      'replace',
    );
    return;
  }
  writeHistoryState(createDetailHistoryState(tab, detail, true, currentDepth + 1), 'push');
}

export function closeAppHistoryDetail(tab: AppHistoryTab): AppHistoryCloseMode {
  if (hydrating) return 'replace';
  if (canSafelyGoBack()) {
    window.history.back();
    return 'back';
  }
  writeHistoryState(createShellHistoryState(tab), 'replace');
  return 'replace';
}

function ensureAppHistoryEstablished(tab: AppHistoryTab): AppHistoryState {
  return readCurrentAppHistoryState() ?? establishAppHistoryShell(tab);
}

function extractCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return APP_HISTORY_KEY in record ? record[APP_HISTORY_KEY] : null;
}

function parseDetail(raw: unknown): AppHistoryDetail | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!KIND_SET.has(record.kind as string) || !isNonEmptyString(record.id)) return null;
  const kind = record.kind as AppHistoryDetailKind;
  if (kind === 'category') {
    const category = parseCategoryLocator(record.category);
    if (!category) return null;
    return { kind, id: record.id, category };
  }
  if (record.category !== undefined) {
    const category = parseCategoryLocator(record.category);
    if (!category) return null;
    return { kind, id: record.id, category };
  }
  return { kind, id: record.id };
}

function parseCategoryLocator(raw: unknown): AppHistoryCategoryLocator | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isNonEmptyString(record.primary) || !isNonEmptyString(record.secondary)) return null;
  return { primary: record.primary, secondary: record.secondary };
}

function detailChainDepth(state: AppHistoryState): number {
  if (!state.detail) return 0;
  if (typeof state.depth === 'number') return clampDetailDepth(state.depth);
  return state.pushedFromApp === true ? 1 : 0;
}

function clampDetailDepth(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_DETAIL_CHAIN_DEPTH);
}

function isSafeDepth(value: unknown, hasDetail: boolean): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  if (hasDetail) return value >= 1 && value <= MAX_DETAIL_CHAIN_DEPTH;
  return value === 0;
}

function detailsEqual(a?: AppHistoryDetail, b?: AppHistoryDetail): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind !== 'category' && b.kind !== 'category') return true;
  return (
    a.category?.primary === b.category?.primary && a.category?.secondary === b.category?.secondary
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAppShellLocation(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  return path === '/' || path === '';
}

function readHistoryState(): unknown {
  if (typeof window === 'undefined') return null;
  return window.history.state;
}

function writeHistoryState(state: AppHistoryState, mode: 'push' | 'replace'): void {
  if (typeof window === 'undefined' || hydrating || !isAppShellLocation()) return;
  const next = mergeHistoryState(state);
  if (mode === 'push') {
    window.history.pushState(next, '');
    return;
  }
  window.history.replaceState(next, '');
}

function mergeHistoryState(state: AppHistoryState): Record<string, unknown> {
  const current = window.history.state;
  const base =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  base[APP_HISTORY_KEY] = state;
  return base;
}
