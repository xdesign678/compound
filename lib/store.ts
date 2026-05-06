import { create } from 'zustand';

// Re-export all slice types and constants for backward compatibility
export {
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
  ERROR_MESSAGES,
  friendlyErrorMessage,
  DEFAULT_LIBRARY_STATE,
  DEFAULT_SOURCES_STATE,
} from './store/ui-slice';
export type {
  TabId,
  ActivitySubTab,
  ActivityFilterType,
  HomeStyle,
  ColorMode,
  FontSize,
  LineHeight,
  ToastState,
  LibraryUIState,
  SourcesUIState,
} from './store/ui-slice';
export type { TaskStatus, TaskKind, TaskItem } from './store/task-slice';
export type { LintFinding } from './store/lint-slice';

import { createUISlice } from './store/ui-slice';
import { createTaskSlice } from './store/task-slice';
import { createLintSlice } from './store/lint-slice';
import { createPreferencesSlice } from './store/preferences-slice';

export type { AppState } from './store/types';
import type { AppState } from './store/types';

export const useAppStore = create<AppState>((...a) => ({
  ...createUISlice(...a),
  ...createTaskSlice(...a),
  ...createLintSlice(...a),
  ...createPreferencesSlice(...a),
}));
