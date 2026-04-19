import { create } from 'zustand';

export type TabId = 'wiki' | 'sources' | 'ask' | 'activity';
export type ActivitySubTab = 'health' | 'log';
export type ActivityFilterType = 'all' | 'ingest' | 'query' | 'lint';

interface DetailState {
  type: 'concept' | 'source';
  id: string;
}

interface ToastState {
  visible: boolean;
  text: string;
  loading: boolean;
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
  toast: ToastState;
  freshConceptIds: Record<string, true>;

  // Activity tab state
  activitySubTab: ActivitySubTab;
  activityFilter: ActivityFilterType;
  lintFindings: LintFinding[];
  lastLintAt: number | null;
  lintRunning: boolean;

  setTab: (t: TabId) => void;
  openConcept: (id: string) => void;
  openSource: (id: string) => void;
  back: () => void;
  openModal: () => void;
  closeModal: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  showToast: (text: string, loading?: boolean) => void;
  hideToast: () => void;
  markFresh: (ids: string[]) => void;
  clearFresh: () => void;
  clearAskHistory: () => Promise<void>;
  setActivitySubTab: (t: ActivitySubTab) => void;
  setActivityFilter: (f: ActivityFilterType) => void;
  setLintResult: (findings: LintFinding[]) => void;
  setLintRunning: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'wiki',
  detail: null,
  modalOpen: false,
  settingsOpen: false,
  toast: { visible: false, text: '', loading: false },
  freshConceptIds: {} as Record<string, true>,

  activitySubTab: 'health',
  activityFilter: 'all',
  lintFindings: [],
  lastLintAt: typeof window !== 'undefined' ? (() => { const v = localStorage.getItem('compound_last_lint'); return v ? Number(v) : null; })() : null,
  lintRunning: false,

  setTab: (t) => set({ tab: t, detail: null }),
  openConcept: (id) => set({ detail: { type: 'concept', id } }),
  openSource: (id) => set({ detail: { type: 'source', id } }),
  back: () => set({ detail: null }),
  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  showToast: (text, loading = false) => set({ toast: { visible: true, text, loading } }),
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
    set({ lintFindings: findings, lastLintAt: now, lintRunning: false });
  },
  setLintRunning: (v) => set({ lintRunning: v }),
}));
