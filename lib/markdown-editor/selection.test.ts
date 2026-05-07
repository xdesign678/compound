import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMarkdownSelectionEdit } from './selection';

test('applyMarkdownSelectionEdit wraps selected text', () => {
  const result = applyMarkdownSelectionEdit({
    value: 'hello world',
    selectionStart: 6,
    selectionEnd: 11,
    command: 'bold',
  });

  assert.equal(result.value, 'hello **world**');
  assert.equal(result.selectionStart, 8);
  assert.equal(result.selectionEnd, 13);
});

test('applyMarkdownSelectionEdit prefixes selected lines', () => {
  const result = applyMarkdownSelectionEdit({
    value: 'one\ntwo',
    selectionStart: 0,
    selectionEnd: 7,
    command: 'list',
  });

  assert.equal(result.value, '- one\n- two');
});

test('applyMarkdownSelectionEdit toggles markdown heading', () => {
  const headed = applyMarkdownSelectionEdit({
    value: 'Title',
    selectionStart: 0,
    selectionEnd: 5,
    command: 'heading',
  });
  const plain = applyMarkdownSelectionEdit({
    value: headed.value,
    selectionStart: 0,
    selectionEnd: headed.value.length,
    command: 'heading',
  });

  assert.equal(headed.value, '## Title');
  assert.equal(plain.value, 'Title');
});
