import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  forgetCustomModel,
  getModelForTask,
  getSelectedAskModel,
  getSelectedWikiModel,
  rememberCustomModel,
  saveSelectedAskModel,
  saveSelectedModel,
  saveSelectedWikiModel,
} from './model-history';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function withTempDataDir(t: TestContext) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-model-history-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();

  t.after(() => {
    closeServerDbGlobal();
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });
}

const presetValues = new Set(['anthropic/claude-sonnet-4.6', 'openai/gpt-4o']);

test('rememberCustomModel stores a trimmed custom model first', () => {
  assert.deepEqual(rememberCustomModel(['xai/grok-4'], '  deepseek/deepseek-r1  ', presetValues), [
    'deepseek/deepseek-r1',
    'xai/grok-4',
  ]);
});

test('rememberCustomModel deduplicates and ignores preset models', () => {
  assert.deepEqual(
    rememberCustomModel(
      ['deepseek/deepseek-r1', 'xai/grok-4'],
      'deepseek/deepseek-r1',
      presetValues,
    ),
    ['deepseek/deepseek-r1', 'xai/grok-4'],
  );
  assert.deepEqual(rememberCustomModel(['deepseek/deepseek-r1'], 'openai/gpt-4o', presetValues), [
    'deepseek/deepseek-r1',
  ]);
});

test('rememberCustomModel keeps only recent custom models', () => {
  const existing = Array.from({ length: 24 }, (_, index) => `provider/model-${index}`);
  const remembered = rememberCustomModel(existing, 'provider/latest', presetValues);

  assert.equal(remembered.length, 20);
  assert.equal(remembered[0], 'provider/latest');
  assert.equal(remembered.at(-1), 'provider/model-18');
});

test('forgetCustomModel removes one normalized custom model', () => {
  const existing = ['deepseek/deepseek-r1', 'xai/grok-4'];
  assert.deepEqual(forgetCustomModel(existing, '  deepseek/deepseek-r1  ', presetValues), [
    'xai/grok-4',
  ]);
});

test('stores separate wiki and ask model selections', (t) => {
  withTempDataDir(t);

  saveSelectedWikiModel(' deepseek/deepseek-v4-flash ');
  saveSelectedAskModel(' openai/gpt-4o ');

  assert.equal(getSelectedWikiModel(), 'deepseek/deepseek-v4-flash');
  assert.equal(getSelectedAskModel(), 'openai/gpt-4o');
  assert.equal(getModelForTask('ingest'), 'deepseek/deepseek-v4-flash');
  assert.equal(getModelForTask('query'), 'openai/gpt-4o');
});

test('legacy selected model still feeds both model slots until split settings are saved', (t) => {
  withTempDataDir(t);

  saveSelectedModel(' anthropic/claude-sonnet-4.6 ');

  assert.equal(getSelectedWikiModel(), 'anthropic/claude-sonnet-4.6');
  assert.equal(getSelectedAskModel(), 'anthropic/claude-sonnet-4.6');
});
