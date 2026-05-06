import type { StateCreator } from 'zustand';
import type { AppState } from '../store';

export interface LintFinding {
  type: 'contradiction' | 'orphan' | 'missing-link' | 'duplicate';
  message: string;
  conceptIds: string[];
}

interface LintBannerState {
  tone: 'running' | 'error';
  title: string;
  details: string;
}

function readStoredLintTimestamp(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('compound_last_lint');
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface LintSlice {
  lintFindings: LintFinding[];
  lastLintAt: number | null;
  lintRunning: boolean;
  lintBanner: LintBannerState | null;

  setLintResult: (findings: LintFinding[]) => void;
  setLintRunning: (v: boolean) => void;
  setLintBanner: (banner: LintBannerState | null) => void;
  hydrateLastLintAt: () => void;
}

export const createLintSlice: StateCreator<AppState, [], [], LintSlice> = (set) => ({
  lintFindings: [],
  lastLintAt: readStoredLintTimestamp(),
  lintRunning: false,
  lintBanner: null,

  setLintResult: (findings) => {
    const now = Date.now();
    localStorage.setItem('compound_last_lint', String(now));
    set({ lintFindings: findings, lastLintAt: now, lintRunning: false, lintBanner: null });
  },
  setLintRunning: (v) => set({ lintRunning: v }),
  setLintBanner: (banner) => set({ lintBanner: banner }),
  hydrateLastLintAt: () => set({ lastLintAt: readStoredLintTimestamp() }),
});
