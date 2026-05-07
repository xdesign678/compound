import type { SelectionWikiRunStartResponse } from './types';

export interface TrackedSelectionWikiRun {
  runId: string;
  selectionPreview: string;
  startedAt: number;
}

export const SELECTION_WIKI_RUNS_EVENT = 'compound:selection-wiki-run';

const STORAGE_KEY = 'compound_selection_wiki_runs_v1';
const MAX_TRACKED_RUNS = 5;

export function readTrackedSelectionWikiRuns(): TrackedSelectionWikiRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrackedSelectionWikiRun[];
    return parsed.filter((run) => run.runId && run.startedAt).slice(0, MAX_TRACKED_RUNS);
  } catch {
    return [];
  }
}

export function rememberSelectionWikiRun(run: SelectionWikiRunStartResponse): void {
  if (typeof window === 'undefined') return;
  const tracked: TrackedSelectionWikiRun = {
    runId: run.runId,
    selectionPreview: run.selectionPreview,
    startedAt: run.startedAt,
  };
  const next = [
    tracked,
    ...readTrackedSelectionWikiRuns().filter((item) => item.runId !== run.runId),
  ].slice(0, MAX_TRACKED_RUNS);
  writeTrackedSelectionWikiRuns(next);
  window.dispatchEvent(new CustomEvent(SELECTION_WIKI_RUNS_EVENT, { detail: tracked }));
}

export function forgetSelectionWikiRun(runId: string): void {
  if (typeof window === 'undefined') return;
  writeTrackedSelectionWikiRuns(
    readTrackedSelectionWikiRuns().filter((item) => item.runId !== runId),
  );
}

function writeTrackedSelectionWikiRuns(runs: TrackedSelectionWikiRun[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
}
