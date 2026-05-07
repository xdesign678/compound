import type { StateCreator } from 'zustand';
import { OFFLINE_WRITE_MAX_BYTES } from '../cloud-sync';
import type { AppState } from './types';

export type TaskStatus = 'queued' | 'running' | 'paused-offline' | 'success' | 'error';
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
  retryCount?: number;
  queuedPayloadBytes?: number;
}

const MAX_TASKS = 20;
const MAX_OFFLINE_RETRIES = 3;

export interface TaskSlice {
  tasks: TaskItem[];
  taskCenterOpen: boolean;

  addTask: (task: TaskItem) => void;
  updateTask: (id: string, patch: Partial<TaskItem>) => void;
  removeTask: (id: string) => void;
  clearFinishedTasks: () => void;
  replayPausedOfflineTasks: () => Promise<void>;
  setTaskCenterOpen: (v: boolean) => void;
  toggleTaskCenter: () => void;
}

function isOfflineLikeError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /offline|network|fetch failed|failed to fetch|离线/i.test(msg);
}

export const createTaskSlice: StateCreator<AppState, [], [], TaskSlice> = (set, get) => ({
  tasks: [],
  taskCenterOpen: false,

  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks].slice(0, MAX_TASKS) })),
  updateTask: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  clearFinishedTasks: () =>
    set((s) => ({
      tasks: s.tasks.filter((t) => ['queued', 'running', 'paused-offline'].includes(t.status)),
    })),
  replayPausedOfflineTasks: async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const queue = get()
      .tasks.filter((task) => task.status === 'paused-offline' && task.retry)
      .sort((a, b) => a.startedAt - b.startedAt);

    for (const task of queue) {
      const latest = get().tasks.find((item) => item.id === task.id);
      if (!latest || latest.status !== 'paused-offline' || !latest.retry) continue;

      if ((latest.queuedPayloadBytes ?? 0) > OFFLINE_WRITE_MAX_BYTES) {
        set((s) => ({
          tasks: s.tasks.map((item) =>
            item.id === latest.id
              ? {
                  ...item,
                  status: 'error',
                  finishedAt: Date.now(),
                  error: '离线队列单条内容超过 256KB，请联网后重新提交。',
                }
              : item,
          ),
        }));
        continue;
      }

      const nextRetryCount = (latest.retryCount ?? 0) + 1;
      set((s) => ({
        taskCenterOpen: true,
        tasks: s.tasks.map((item) =>
          item.id === latest.id
            ? {
                ...item,
                status: 'running',
                retryCount: nextRetryCount,
                error: undefined,
                result: '正在恢复写入',
              }
            : item,
        ),
      }));

      try {
        await latest.retry();
        const afterRetry = get().tasks.find((item) => item.id === latest.id);
        if (afterRetry?.status === 'running') {
          set((s) => ({
            tasks: s.tasks.map((item) =>
              item.id === latest.id
                ? {
                    ...item,
                    status: 'success',
                    finishedAt: Date.now(),
                    error: undefined,
                    result: afterRetry.result || '联网后已自动写入',
                  }
                : item,
            ),
          }));
        }
      } catch (err) {
        const offline = isOfflineLikeError(err);
        const exhausted = nextRetryCount >= MAX_OFFLINE_RETRIES;
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({
          tasks: s.tasks.map((item) =>
            item.id === latest.id
              ? {
                  ...item,
                  status: offline && !exhausted ? 'paused-offline' : 'error',
                  finishedAt: offline && !exhausted ? undefined : Date.now(),
                  error:
                    offline && !exhausted
                      ? `离线暂停，联网后会继续重试（${nextRetryCount}/${MAX_OFFLINE_RETRIES}）。`
                      : msg.slice(0, 160),
                  result: undefined,
                }
              : item,
          ),
        }));
      }
    }
  },
  setTaskCenterOpen: (v) => set({ taskCenterOpen: v }),
  toggleTaskCenter: () => set((s) => ({ taskCenterOpen: !s.taskCenterOpen })),
});
