import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from 'zustand';
import {
  APP_HISTORY_KEY,
  finalizeAppHistoryTabCollapse,
  parseAppHistoryState,
} from '../app-history';
import { createUISlice, friendlyErrorMessage, ERROR_MESSAGES } from './ui-slice';
import type { AppState } from './types';

function createUIStore() {
  return create<AppState>()((...args) => ({ ...createUISlice(...args) }) as AppState);
}

test('friendlyErrorMessage maps parenthesized status codes', () => {
  assert.equal(friendlyErrorMessage('Unauthorized (401)'), ERROR_MESSAGES['401']);
  assert.equal(friendlyErrorMessage('请求失败 (503)'), ERROR_MESSAGES['503']);
});

test('friendlyErrorMessage 401 copy points back to home re-auth, not Admin Token', () => {
  const message = friendlyErrorMessage('Unauthorized (401)');
  assert.match(message, /返回首页/);
  assert.ok(!message.includes('Admin Token'));
});

test('friendlyErrorMessage maps bare network failure texts', () => {
  assert.equal(friendlyErrorMessage('Failed to fetch'), ERROR_MESSAGES.NETWORK);
  assert.equal(
    friendlyErrorMessage('NetworkError when attempting to fetch resource.'),
    ERROR_MESSAGES.NETWORK,
  );
  assert.equal(friendlyErrorMessage('The operation was aborted'), ERROR_MESSAGES.abort);
  assert.equal(
    friendlyErrorMessage('{"error":"Unauthorized","requestId":"abc"}'),
    ERROR_MESSAGES['401'],
  );
});

test('friendlyErrorMessage keeps unknown short errors and truncates long ones', () => {
  assert.equal(friendlyErrorMessage('自定义错误'), '自定义错误');
  const long = 'x'.repeat(200);
  const friendly = friendlyErrorMessage(long);
  assert.equal(friendly.length, 121);
  assert.ok(friendly.endsWith('…'));
});

test('showErrorToast clears lingering loading toasts from the queue', () => {
  const useStore = createUIStore();
  useStore.getState().showToast('AI 正在体检 Wiki…', true);
  assert.equal(useStore.getState().toast.loading, true);

  useStore.getState().showErrorToast('服务器错误 (500)');
  const state = useStore.getState();
  assert.equal(state.toast.isError, true);
  assert.equal(state.toast.loading, false);
  assert.equal(state.toast.text, ERROR_MESSAGES['500']);
  assert.equal(
    state.toastQueue.some((t) => t.loading),
    false,
  );
});

test('hideToast clears lingering loading toasts from the queue', () => {
  const useStore = createUIStore();
  useStore.getState().showToast('处理中…', true);
  assert.equal(useStore.getState().toastQueue.length, 1);

  useStore.getState().hideToast();
  const state = useStore.getState();
  assert.equal(state.toast.visible, false);
  assert.equal(state.toastQueue.length, 0);
});

interface MemoryHistory {
  stack: unknown[];
  index: number;
  pushCount: number;
  replaceCount: number;
  backCount: number;
}

function installMemoryHistory(initialState: unknown = null): MemoryHistory {
  const memory: MemoryHistory = {
    stack: [initialState],
    index: 0,
    pushCount: 0,
    replaceCount: 0,
    backCount: 0,
  };
  const history = {
    get length() {
      return memory.stack.length;
    },
    get state() {
      return memory.stack[memory.index] ?? null;
    },
    pushState(state: unknown) {
      memory.stack.splice(memory.index + 1);
      memory.stack.push(state);
      memory.index = memory.stack.length - 1;
      memory.pushCount += 1;
    },
    replaceState(state: unknown) {
      memory.stack[memory.index] = state;
      memory.replaceCount += 1;
    },
    back() {
      memory.backCount += 1;
      if (memory.index > 0) memory.index -= 1;
    },
    go(delta: number) {
      const next = memory.index + delta;
      if (next < 0 || next >= memory.stack.length) return;
      memory.index = next;
    },
  };
  const windowLike = { history, location: { pathname: '/' } };
  Object.defineProperty(globalThis, 'window', { value: windowLike, configurable: true });
  Object.defineProperty(globalThis, 'history', { value: history, configurable: true });
  return memory;
}

test('setTab replaces history with a shell and clears stale detail', () => {
  const memory = installMemoryHistory();
  const useStore = createUIStore();
  useStore.getState().openConcept('c-a');
  assert.equal(useStore.getState().detail?.id, 'c-a');
  assert.equal(memory.pushCount, 1);

  useStore.getState().setTab('sources');
  assert.equal(useStore.getState().tab, 'sources');
  assert.equal(useStore.getState().detail, null);
  finalizeAppHistoryTabCollapse();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'sources');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
  assert.equal(
    memory.stack.some((entry) => parseAppHistoryState(entry)?.detail),
    false,
  );
});

test('setTab from detail B collapses A so browser back cannot resurrect it', () => {
  const memory = installMemoryHistory();
  const useStore = createUIStore();
  useStore.getState().openConcept('c-a');
  useStore.getState().openConcept('c-b');
  assert.equal(useStore.getState().detail?.id, 'c-b');

  useStore.getState().setTab('sources');
  assert.equal(useStore.getState().tab, 'sources');
  assert.equal(useStore.getState().detail, null);
  finalizeAppHistoryTabCollapse();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'sources');
  assert.equal(
    memory.stack.some((entry) => parseAppHistoryState(entry)?.detail),
    false,
  );

  memory.index -= 1;
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
});

test('opening details pushes A then B, and back uses history.back for app-owned entries', () => {
  const memory = installMemoryHistory();
  const useStore = createUIStore();
  useStore.getState().openConcept('c-a');
  useStore.getState().openConcept('c-a');
  useStore.getState().openConcept('c-b');
  useStore.getState().openSource('s-1');
  assert.equal(memory.pushCount, 3);
  assert.equal(useStore.getState().detail?.id, 's-1');

  useStore.getState().back();
  assert.equal(memory.backCount, 1);
  assert.equal(useStore.getState().detail?.id, 's-1');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail?.id, 'c-b');
});

test('back replaces a local shell when the current history entry is not a safe app push', () => {
  const memory = installMemoryHistory({ junk: true });
  const useStore = createUIStore();
  useStore.setState({ detail: { type: 'concept', id: 'c-local' } });
  useStore.getState().back();
  assert.equal(memory.backCount, 0);
  assert.equal(memory.replaceCount, 1);
  assert.equal(useStore.getState().detail, null);
  assert.equal(parseAppHistoryState(memory.stack[0])?.tab, 'wiki');
  assert.equal(parseAppHistoryState(memory.stack[0])?.detail, undefined);
  assert.equal(APP_HISTORY_KEY in (memory.stack[0] as object), true);
});
