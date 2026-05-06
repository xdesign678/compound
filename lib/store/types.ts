import type { UISlice } from './ui-slice';
import type { TaskSlice } from './task-slice';
import type { LintSlice } from './lint-slice';
import type { PreferencesSlice } from './preferences-slice';

export type AppState = UISlice & TaskSlice & LintSlice & PreferencesSlice;
