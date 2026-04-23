import { create } from 'zustand';

export type TabId = 'wiki' | 'sources' | 'ask' | 'activity';
export type ActivitySubTab = 'health' | 'log';
export type ActivityFilterType = 'all' | 'ingest' | 'query' | 'lint';
export type HomeStyle = 'feed' | 'library';

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
  searchCollapsed: boolean;
  searchFocusNonce: number;

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
  setSearchCollapsed: (v: boolean) => void;
  triggerSearchFocus: () => void;
}

function readStoredLintTimestamp() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('compound_last_lint');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredHomeStyle(): HomeStyle {
  if (typeof window === 'undefined') return 'feed';
  const raw = localStorage.getItem('compound_home_style');
  return raw === 'library' ? 'library' : 'feed';
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
  searchCollapsed: false,
  searchFocusNonce: 0,

  setTab: (t) => set({ tab: t, detail: null }),
  openConcept: (id) => set({ detail: { type: 'concept', id } }),
  openSource: (id) => set({ detail: { type: 'source', id } }),
  back: () => set({ detail: null }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openObsidianImport: () => set({ obsidianImportOpen: true }),
  closeObsidianImport: () => set({ obsidianImportOpen: false }),
  openGithubSync: () => set({ githubSyncOpen: true }),
  closeGithubSync: () => set({ githubSyncOpen: false }),
  showToast: (text, loading = false, isError = false) => set({ toast: { visible: true, text, loading, isError } }),
  hideToast: () => set((s) => ({ toast: { ...s.toast, visible: false } })),
  markFresh: (ids: string[]) => set((s) => {
    const next = { ...s.freshConceptIds };
    ids.forEach(id => { next[id] = true; });
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
  setSearchCollapsed: (v) => set((s) => (s.searchCollapsed === v ? s : { searchCollapsed: v })),
  triggerSearchFocus: () => set((s) => ({ searchFocusNonce: s.searchFocusNonce + 1 })),
}));
