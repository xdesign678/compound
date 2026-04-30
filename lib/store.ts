import { create } from 'zustand';

export type TabId = 'wiki' | 'sources' | 'ask' | 'activity';
export type ActivitySubTab = 'health' | 'log';
export type ActivityFilterType = 'all' | 'ingest' | 'query' | 'lint';
export type HomeStyle = 'feed' | 'library';
export type ColorMode = 'light' | 'dark' | 'system';

export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export const FONT_SIZE_MAP: Record<FontSize, { label: string; px: number }> = {
  xs: { label: '小', px: 14 },
  sm: { label: '较小', px: 15 },
  md: { label: '中', px: 16 },
  lg: { label: '较大', px: 18 },
  xl: { label: '大', px: 20 },
};

export type LineHeight = 'compact' | 'snug' | 'standard' | 'relaxed' | 'loose';

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

interface ToastState {
  visible: boolean;
  text: string;
  loading: boolean;
  isError?: boolean;
}

interface LintBannerState {
  tone: 'running' | 'error';
  title: string;
  details: string;
}

export interface LintFinding {
  type: 'contradiction' | 'orphan' | 'missing-link' | 'duplicate';
  message: string;
  conceptIds: string[];
}

export interface LibraryUIState {
  query: string;
  selectedPrimary: string | null;
  selectedSecondary: string | null;
  visibleCount: number;
  showAllSecondaries: boolean;
  scrollTop: number;
}

const DEFAULT_LIBRARY_VISIBLE_COUNT = 60;

const DEFAULT_LIBRARY_STATE: LibraryUIState = {
  query: '',
  selectedPrimary: null,
  selectedSecondary: null,
  visibleCount: DEFAULT_LIBRARY_VISIBLE_COUNT,
  showAllSecondaries: false,
  scrollTop: 0,
};

export interface SourcesUIState {
  query: string;
  visibleCount: number;
  scrollTop: number;
}

const DEFAULT_SOURCES_VISIBLE_COUNT = 50;

const DEFAULT_SOURCES_STATE: SourcesUIState = {
  query: '',
  visibleCount: DEFAULT_SOURCES_VISIBLE_COUNT,
  scrollTop: 0,
};

interface AppState {
  tab: TabId;
  detail: DetailState | null;
  modalOpen: boolean;
  settingsOpen: boolean;
  obsidianImportOpen: boolean;
  githubSyncOpen: boolean;
  toast: ToastState;
  freshConceptIds: Record<string, true>;

  // Activity tab state
  activitySubTab: ActivitySubTab;
  activityFilter: ActivityFilterType;
  lintFindings: LintFinding[];
  lastLintAt: number | null;
  lintRunning: boolean;
  lintBanner: LintBannerState | null;
  homeStyle: HomeStyle;
  colorMode: ColorMode;
  fontSize: FontSize;
  lineHeight: LineHeight;
  searchCollapsed: boolean;
  searchFocusNonce: number;
  libraryState: LibraryUIState;
  sourcesState: SourcesUIState;

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
  showToast: (text: string, loading?: boolean, isError?: boolean) => void;
  hideToast: () => void;
  markFresh: (ids: string[]) => void;
  clearFresh: () => void;
  clearAskHistory: () => Promise<void>;
  setActivitySubTab: (t: ActivitySubTab) => void;
  setActivityFilter: (f: ActivityFilterType) => void;
  setLintResult: (findings: LintFinding[]) => void;
  setLintRunning: (v: boolean) => void;
  setLintBanner: (banner: LintBannerState | null) => void;
  hydrateLastLintAt: () => void;
  setHomeStyle: (s: HomeStyle) => void;
  hydrateHomeStyle: () => void;
  setColorMode: (mode: ColorMode) => void;
  hydrateColorMode: () => void;
  setFontSize: (size: FontSize) => void;
  hydrateFontSize: () => void;
  setLineHeight: (lh: LineHeight) => void;
  hydrateLineHeight: () => void;
  setSearchCollapsed: (v: boolean) => void;
  triggerSearchFocus: () => void;
  setLibraryState: (patch: Partial<LibraryUIState>) => void;
  resetLibraryState: () => void;
  setSourcesState: (patch: Partial<SourcesUIState>) => void;
  resetSourcesState: () => void;
}

function readStoredLintTimestamp() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('compound_last_lint');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
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

function applyFontSize(size: FontSize) {
  if (typeof window === 'undefined') return;
  const px = FONT_SIZE_MAP[size].px;
  document.documentElement.style.setProperty('--prose-font-size', `${px}px`);
}

function readStoredLineHeight(): LineHeight {
  if (typeof window === 'undefined') return 'standard';
  const raw = localStorage.getItem('compound_line_height');
  if (raw && raw in LINE_HEIGHT_MAP) return raw as LineHeight;
  return 'standard';
}

function applyLineHeight(lh: LineHeight) {
  if (typeof window === 'undefined') return;
  const val = LINE_HEIGHT_MAP[lh].value;
  document.documentElement.style.setProperty('--prose-line-height', String(val));
}

// Module-level toast auto-dismiss timer
let _toastTimer: ReturnType<typeof setTimeout> | null = null;

function applyColorMode(mode: ColorMode) {
  if (typeof window === 'undefined') return;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    mode === 'dark' || (mode === 'system' && prefersDark),
  );
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'wiki',
  detail: null,
  modalOpen: false,
  settingsOpen: false,
  obsidianImportOpen: false,
  githubSyncOpen: false,
  toast: { visible: false, text: '', loading: false },
  freshConceptIds: {} as Record<string, true>,

  activitySubTab: 'health',
  activityFilter: 'all',
  lintFindings: [],
  lastLintAt: readStoredLintTimestamp(),
  lintRunning: false,
  lintBanner: null,
  homeStyle: readStoredHomeStyle(),
  colorMode: 'light',
  fontSize: 'md',
  lineHeight: 'standard',
  searchCollapsed: false,
  searchFocusNonce: 0,
  libraryState: { ...DEFAULT_LIBRARY_STATE },
  sourcesState: { ...DEFAULT_SOURCES_STATE },

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
  showToast: (text, loading = false, isError = false) => {
    if (_toastTimer) {
      clearTimeout(_toastTimer);
      _toastTimer = null;
    }
    set({ toast: { visible: true, text, loading, isError } });
    if (!loading && !isError) {
      _toastTimer = setTimeout(() => {
        set((s) => ({ toast: { ...s.toast, visible: false } }));
        _toastTimer = null;
      }, 3000);
    }
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
    const { getDb } = await import('./db');
    await getDb().askHistory.clear();
  },
  setActivitySubTab: (t) => set({ activitySubTab: t }),
  setActivityFilter: (f) => set({ activityFilter: f }),
  setLintResult: (findings) => {
    const now = Date.now();
    localStorage.setItem('compound_last_lint', String(now));
    set({ lintFindings: findings, lastLintAt: now, lintRunning: false, lintBanner: null });
  },
  setLintRunning: (v) => set({ lintRunning: v }),
  setLintBanner: (banner) => set({ lintBanner: banner }),
  hydrateLastLintAt: () => set({ lastLintAt: readStoredLintTimestamp() }),
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
    set({ fontSize: size });
  },
  hydrateFontSize: () => {
    const size = readStoredFontSize();
    applyFontSize(size);
    set({ fontSize: size });
  },
  setLineHeight: (lh) => {
    localStorage.setItem('compound_line_height', lh);
    applyLineHeight(lh);
    set({ lineHeight: lh });
  },
  hydrateLineHeight: () => {
    const lh = readStoredLineHeight();
    applyLineHeight(lh);
    set({ lineHeight: lh });
  },
  setSearchCollapsed: (v) => set((s) => (s.searchCollapsed === v ? s : { searchCollapsed: v })),
  triggerSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
  setLibraryState: (patch) => set((s) => ({ libraryState: { ...s.libraryState, ...patch } })),
  resetLibraryState: () => set({ libraryState: { ...DEFAULT_LIBRARY_STATE } }),
  setSourcesState: (patch) => set((s) => ({ sourcesState: { ...s.sourcesState, ...patch } })),
  resetSourcesState: () => set({ sourcesState: { ...DEFAULT_SOURCES_STATE } }),
}));
