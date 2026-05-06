import type { StateCreator } from 'zustand';
import type { AppState } from '../store';

export type TabId = 'wiki' | 'sources' | 'ask' | 'activity';
export type ActivitySubTab = 'health' | 'log';
export type ActivityFilterType = 'all' | 'ingest' | 'query' | 'lint';
export type HomeStyle = 'feed' | 'library';
export type ColorMode = 'light' | 'dark' | 'system';
export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type LineHeight = 'compact' | 'snug' | 'standard' | 'relaxed' | 'loose';

export const FONT_SIZE_MAP: Record<FontSize, { label: string; px: number }> = {
  xs: { label: '小', px: 14 },
  sm: { label: '较小', px: 15 },
  md: { label: '中', px: 16 },
  lg: { label: '较大', px: 18 },
  xl: { label: '大', px: 20 },
};

export const LINE_HEIGHT_MAP: Record<LineHeight, { label: string; value: number }> = {
  compact: { label: '紧凑', value: 1.5 },
  snug: { label: '偏紧', value: 1.65 },
  standard: { label: '标准', value: 1.75 },
  relaxed: { label: '宽松', value: 1.85 },
  loose: { label: '舒展', value: 2.0 },
};

interface DetailState {
  type: 'concept' | 'source';
  id: string;
}

export interface ToastState {
  visible: boolean;
  text: string;
  loading: boolean;
  isError?: boolean;
  retry?: () => void | Promise<void>;
  retryLabel?: string;
  id: number;
}

/** Friendly error message mapping */
export const ERROR_MESSAGES: Record<string, string> = {
  '502': '服务暂时不可用，请稍后重试或检查网络',
  '503': '服务暂时不可用，请稍后重试',
  '429': '请求过于频繁，请稍后再试',
  '401': '认证失败，请在设置中检查 API 配置',
  '403': '访问被拒绝，请检查认证信息',
  '500': '服务器内部错误，请稍后重试',
  TIMEOUT: '请求超时，请检查网络后重试',
  OFFLINE: '网络已断开，请检查连接后重试',
  NETWORK: '网络连接失败，请检查网络设置',
  INGEST_FAIL: '摄入失败，请检查资料内容或重试',
  LINT_FAIL: '体检失败，请稍后重试',
  QUERY_FAIL: '问答失败，请稍后重试',
};

/** Extract friendly error message from raw error */
export function friendlyErrorMessage(raw: string): string {
  const statusMatch = raw.match(/\((\d{3})\)/);
  if (statusMatch) {
    const code = statusMatch[1];
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  }
  for (const [key, msg] of Object.entries(ERROR_MESSAGES)) {
    if (raw.includes(key) || raw.toLowerCase().includes(key.toLowerCase())) {
      return msg;
    }
  }
  return raw.length > 120 ? raw.slice(0, 120) + '…' : raw;
}

export interface LibraryUIState {
  query: string;
  selectedPrimary: string | null;
  selectedSecondary: string | null;
  visibleCount: number;
  showAllSecondaries: boolean;
  scrollTop: number;
  scrollAnchorId: string | null;
}

export const DEFAULT_LIBRARY_STATE: LibraryUIState = {
  query: '',
  selectedPrimary: null,
  selectedSecondary: null,
  visibleCount: 60,
  showAllSecondaries: false,
  scrollTop: 0,
  scrollAnchorId: null,
};

export interface SourcesUIState {
  query: string;
  visibleCount: number;
  scrollTop: number;
}

export const DEFAULT_SOURCES_STATE: SourcesUIState = {
  query: '',
  visibleCount: 50,
  scrollTop: 0,
};

const MAX_TOAST_QUEUE = 3;
const TOAST_DEDUPE_MS = 2000;

export interface UISlice {
  tab: TabId;
  detail: DetailState | null;
  modalOpen: boolean;
  settingsOpen: boolean;
  obsidianImportOpen: boolean;
  githubSyncOpen: boolean;
  commandPaletteOpen: boolean;
  isOnline: boolean;
  toast: ToastState;
  toastQueue: ToastState[];
  freshConceptIds: Record<string, true>;
  searchCollapsed: boolean;
  searchFocusNonce: number;
  libraryState: LibraryUIState;
  sourcesState: SourcesUIState;
  activitySubTab: ActivitySubTab;
  activityFilter: ActivityFilterType;

  setTab: (t: TabId) => void;
  openConcept: (id: string) => void;
  openSource: (id: string) => void;
  back: () => void;
  openModal: () => void;
  closeModal: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openObsidianImport: () => void;
  closeObsidianImport: () => void;
  openGithubSync: () => void;
  closeGithubSync: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setOnline: (v: boolean) => void;
  showToast: (text: string, loading?: boolean, isError?: boolean) => void;
  showErrorToast: (text: string, retry?: () => void | Promise<void>, retryLabel?: string) => void;
  hideToast: () => void;
  markFresh: (ids: string[]) => void;
  clearFresh: () => void;
  clearAskHistory: () => Promise<void>;
  setActivitySubTab: (t: ActivitySubTab) => void;
  setActivityFilter: (f: ActivityFilterType) => void;
  setSearchCollapsed: (v: boolean) => void;
  triggerSearchFocus: () => void;
  setLibraryState: (patch: Partial<LibraryUIState>) => void;
  resetLibraryState: () => void;
  setSourcesState: (patch: Partial<SourcesUIState>) => void;
  resetSourcesState: () => void;
}

// Toast timer managed inside slice closure
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set) => ({
  tab: 'wiki',
  detail: null,
  modalOpen: false,
  settingsOpen: false,
  obsidianImportOpen: false,
  githubSyncOpen: false,
  commandPaletteOpen: false,
  isOnline: true,
  toast: { visible: false, text: '', loading: false, id: 0 },
  toastQueue: [],
  freshConceptIds: {} as Record<string, true>,
  searchCollapsed: false,
  searchFocusNonce: 0,
  libraryState: { ...DEFAULT_LIBRARY_STATE },
  sourcesState: { ...DEFAULT_SOURCES_STATE },
  activitySubTab: 'health',
  activityFilter: 'all',

  setTab: (t) => set({ tab: t, detail: null }),
  openConcept: (id) => {
    const newDetail: DetailState = { type: 'concept', id };
    set({ detail: newDetail });
    if (typeof window !== 'undefined') {
      history.pushState({ detail: newDetail }, '');
    }
  },
  openSource: (id) => {
    const newDetail: DetailState = { type: 'source', id };
    set({ detail: newDetail });
    if (typeof window !== 'undefined') {
      history.pushState({ detail: newDetail }, '');
    }
  },
  back: () => set({ detail: null }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openObsidianImport: () => set({ obsidianImportOpen: true }),
  closeObsidianImport: () => set({ obsidianImportOpen: false }),
  openGithubSync: () => set({ githubSyncOpen: true }),
  closeGithubSync: () => set({ githubSyncOpen: false }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  setOnline: (v) => set((s) => (s.isOnline === v ? s : { isOnline: v })),
  showToast: (text, loading = false, isError = false) => {
    if (_toastTimer) {
      clearTimeout(_toastTimer);
      _toastTimer = null;
    }
    const id = Date.now();
    const entry: ToastState = { visible: true, text, loading, isError, id };
    set((s) => {
      const recent = s.toastQueue.find(
        (t) => t.text === text && Date.now() - t.id < TOAST_DEDUPE_MS,
      );
      if (recent) return s;
      const queue = [entry, ...s.toastQueue].slice(0, MAX_TOAST_QUEUE);
      return { toast: entry, toastQueue: queue };
    });
    if (!loading && !isError) {
      _toastTimer = setTimeout(() => {
        set((s) => ({
          toast: { ...s.toast, visible: false },
          toastQueue: s.toastQueue.filter((t) => t.id !== id),
        }));
        _toastTimer = null;
      }, 3000);
    }
  },
  showErrorToast: (text, retry, retryLabel = '重试') => {
    if (_toastTimer) {
      clearTimeout(_toastTimer);
      _toastTimer = null;
    }
    const id = Date.now();
    const friendlyText = friendlyErrorMessage(text);
    const entry: ToastState = {
      visible: true,
      text: friendlyText,
      loading: false,
      isError: true,
      retry,
      retryLabel,
      id,
    };
    set((s) => {
      const recent = s.toastQueue.find(
        (t) => t.text === friendlyText && Date.now() - t.id < TOAST_DEDUPE_MS,
      );
      if (recent) return s;
      const queue = [entry, ...s.toastQueue].slice(0, MAX_TOAST_QUEUE);
      return { toast: entry, toastQueue: queue };
    });
  },
  hideToast: () => set((s) => ({ toast: { ...s.toast, visible: false } })),
  markFresh: (ids: string[]) =>
    set((s) => {
      const next = { ...s.freshConceptIds };
      ids.forEach((id) => {
        next[id] = true;
      });
      return { freshConceptIds: next };
    }),
  clearFresh: () => set({ freshConceptIds: {} }),
  clearAskHistory: async () => {
    const { getDb } = await import('../db');
    await getDb().askHistory.clear();
  },
  setActivitySubTab: (t) => set({ activitySubTab: t }),
  setActivityFilter: (f) => set({ activityFilter: f }),
  setSearchCollapsed: (v) => set((s) => (s.searchCollapsed === v ? s : { searchCollapsed: v })),
  triggerSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
  setLibraryState: (patch) => set((s) => ({ libraryState: { ...s.libraryState, ...patch } })),
  resetLibraryState: () => set({ libraryState: { ...DEFAULT_LIBRARY_STATE } }),
  setSourcesState: (patch) => set((s) => ({ sourcesState: { ...s.sourcesState, ...patch } })),
  resetSourcesState: () => set({ sourcesState: { ...DEFAULT_SOURCES_STATE } }),
});
