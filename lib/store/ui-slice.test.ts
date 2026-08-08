import assert from 'node:assert/strict';
import test from 'node:test';
import { create } from 'zustand';
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
