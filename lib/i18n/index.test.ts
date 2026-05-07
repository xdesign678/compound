import test from 'node:test';
import assert from 'node:assert/strict';

import { t } from './index';
import { useAppStore } from '../store';

test('t returns zh-CN by default and interpolates params', () => {
  useAppStore.setState({ locale: 'zh-CN' });
  assert.equal(
    t('header.wiki.subtitle.ready', { conceptCount: 3, sourceCount: 2 }),
    '3 个概念 · 2 份资料',
  );
});

test('t returns migrated English copy when locale is en', () => {
  useAppStore.setState({ locale: 'en' });
  assert.equal(t('tab.sources'), 'Sources');
  assert.equal(
    t('toast.offlineWithTasks', { count: 2 }),
    'Offline. Writes are paused · 2 tasks waiting',
  );
  useAppStore.setState({ locale: 'zh-CN' });
});
