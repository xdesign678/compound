import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSyncStageItems, getCurrentFileDisplay } from './github-sync-ui';

test('highlights the scan step while repository scan is running', () => {
  const items = buildSyncStageItems({
    phase: 'running',
    pulling: false,
    job: {
      status: 'running',
      total: 0,
      done: 0,
      failed: 0,
      current: '扫描 GitHub 仓库…',
    },
  });

  assert.deepEqual(
    items.map((item) => [item.id, item.status]),
    [
      ['scan', 'current'],
      ['plan', 'upcoming'],
      ['process', 'upcoming'],
      ['pull', 'upcoming'],
    ]
  );
});

test('highlights the planning step while diffing local changes', () => {
  const items = buildSyncStageItems({
    phase: 'running',
    pulling: false,
    job: {
      status: 'running',
      total: 95,
      done: 0,
      failed: 0,
      current: '已扫描 95 个文件，正在比对本地差异…',
    },
  });

  assert.equal(items[1]?.status, 'current');
  assert.equal(items[0]?.status, 'done');
});

test('extracts current file counter and path from processing label', () => {
  const display = getCurrentFileDisplay('[42/95] 脑科学与神经科学/决策与偏见/典型性偏好.md');

  assert.deepEqual(display, {
    counter: '42 / 95',
    path: '脑科学与神经科学/决策与偏见/典型性偏好.md',
  });
});

test('highlights pull stage after server sync is done and local pull is running', () => {
  const items = buildSyncStageItems({
    phase: 'done',
    pulling: true,
    job: {
      status: 'done',
      total: 95,
      done: 94,
      failed: 1,
      current: null,
    },
  });

  assert.deepEqual(
    items.map((item) => item.status),
    ['done', 'done', 'done', 'current']
  );
});
