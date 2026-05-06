import type { StateCreator } from 'zustand';
import type { AppState } from '../store';

export type TaskStatus = 'running' | 'success' | 'error';
export type TaskKind = 'ingest' | 'lint' | 'repair' | 'categorize' | 'query';

export interface TaskItem {
  id: string;
  kind: TaskKind;
  label: string;
  status: TaskStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  retry?: () => void | Promise<void>;
  result?: string;
}

const MAX_TASKS = 20;

export interface TaskSlice {
  tasks: TaskItem[];
  taskCenterOpen: boolean;

  addTask: (task: TaskItem) => void;
  updateTask: (id: string, patch: Partial<TaskItem>) => void;
  removeTask: (id: string) => void;
  clearFinishedTasks: () => void;
  setTaskCenterOpen: (v: boolean) => void;
  toggleTaskCenter: () => void;
}

export const createTaskSlice: StateCreator<AppState, [], [], TaskSlice> = (set) => ({
  tasks: [],
  taskCenterOpen: false,

  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks].slice(0, MAX_TASKS) })),
  updateTask: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  clearFinishedTasks: () => set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'running') })),
  setTaskCenterOpen: (v) => set({ taskCenterOpen: v }),
  toggleTaskCenter: () => set((s) => ({ taskCenterOpen: !s.taskCenterOpen })),
});
