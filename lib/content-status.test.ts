import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasConceptBodyContent,
  hasSourceRawContent,
  inferContentStatusFromText,
} from './content-status';

test('inferContentStatusFromText marks non-empty text as full', () => {
  assert.equal(inferContentStatusFromText('  有正文  '), 'full');
});

test('inferContentStatusFromText marks empty text as partial', () => {
  assert.equal(inferContentStatusFromText('   '), 'partial');
  assert.equal(inferContentStatusFromText(undefined), 'partial');
});

test('hasConceptBodyContent accepts legacy rows with body but partial status', () => {
  assert.equal(
    hasConceptBodyContent({
      body: '这是旧数据里已经存在的正文',
      contentStatus: 'partial',
    }),
    true
  );
});

test('hasSourceRawContent accepts legacy rows with content but missing full status', () => {
  assert.equal(
    hasSourceRawContent({
      rawContent: '原文已经在本地了',
      contentStatus: 'partial',
    }),
    true
  );
});
