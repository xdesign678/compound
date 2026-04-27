import test from 'node:test';
import assert from 'node:assert/strict';

import { pickStableConceptTitles } from './ask-suggestions';

test('pickStableConceptTitles keeps recent titles deterministic', () => {
  const concepts = [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }, { title: 'Delta' }];

  assert.deepEqual(pickStableConceptTitles(concepts), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(pickStableConceptTitles(concepts), ['Alpha', 'Beta', 'Gamma']);
});

test('pickStableConceptTitles drops blank titles and respects limit', () => {
  const concepts = [{ title: '  ' }, { title: ' Alpha ' }, { title: 'Beta' }];

  assert.deepEqual(pickStableConceptTitles(concepts, 1), ['Alpha']);
});
