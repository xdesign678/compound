import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from 'zustand';
import { createTaskSlice, type TaskItem } from './task-slice';
import type { AppState } from './types';

function createTaskStore() {
  return create<AppState>()((...args) => ({ ...createTaskSlice(...args) }) as AppState);
}

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: value },
    configurable: true,
  });
}

test('replayPausedOfflineTasks replays paused tasks FIFO', async () => {
  setNavigatorOnline(true);
  const useStore = createTaskStore();
  const replayed: string[] = [];

  const older: TaskItem = {
    id: 'older',
    kind: 'ingest',
    label: '旧任务',
    status: 'paused-offline',
    startedAt: 1,
    retry: async () => {
      replayed.push('older');
    },
  };
  const newer: TaskItem = {
    id: 'newer',
    kind: 'ingest',
    label: '新任务',
    status: 'paused-offline',
    startedAt: 2,
    retry: async () => {
      replayed.push('newer');
    },
  };

  useStore.getState().addTask(newer);
  useStore.getState().addTask(older);

  await useStore.getState().replayPausedOfflineTasks();

  assert.deepEqual(replayed, ['older', 'newer']);
  assert.equal(useStore.getState().tasks.find((task) => task.id === 'older')?.status, 'success');
  assert.equal(useStore.getState().tasks.find((task) => task.id === 'newer')?.status, 'success');
});

test('replayPausedOfflineTasks stops after three offline failures', async () => {
  setNavigatorOnline(true);
  const useStore = createTaskStore();
  let attempts = 0;

  useStore.getState().addTask({
    id: 'offline',
    kind: 'ingest',
    label: '离线任务',
    status: 'paused-offline',
    startedAt: 1,
    retry: async () => {
      attempts += 1;
      throw new Error('offline');
    },
  });

  await useStore.getState().replayPausedOfflineTasks();
  await useStore.getState().replayPausedOfflineTasks();
  await useStore.getState().replayPausedOfflineTasks();

  const task = useStore.getState().tasks.find((item) => item.id === 'offline');
  assert.equal(attempts, 3);
  assert.equal(task?.status, 'error');
  assert.equal(task?.retryCount, 3);
});
