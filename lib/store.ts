import { create } from 'zustand';
import { getDb } from './db';

export type TabId = 'wiki' | 'sources' | 'ask' | 'activity';

interface DetailState {
  type: 'concept' | 'source';
  id: string;
}

interface ToastState {
  visible: boolean;
  text: string;
  loading: boolean;
}

interface AppState {
  tab: TabId;
  detail: DetailState | null;
  modalOpen: boolean;
  settingsOpen: boolean;
  toast: ToastState;
  freshConceptIds: Record<string, true>;

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
}

export const useAppStore = create<AppState>((set) => ({
  tab: 'wiki',
  detail: null,
  modalOpen: false,
  settingsOpen: false,
  toast: { visible: false, text: '', loading: false },
  freshConceptIds: {} as Record<string, true>,

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
  clearAskHistory: async () => { await getDb().askHistory.clear(); },
}));
