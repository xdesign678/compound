import test from 'node:test';
import assert from 'node:assert/strict';

import { forgetCustomModel, rememberCustomModel } from './model-history';

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
