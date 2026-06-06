import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectScrollAnchor, computeAskInputHeightValue } from './scroll-anchor';

describe('selectScrollAnchor', () => {
  it('returns the first visible id by DOM order', () => {
    assert.equal(selectScrollAnchor(['a', 'b', 'c'], new Set(['b', 'c'])), 'b');
  });

  it('returns null when nothing is visible', () => {
    assert.equal(selectScrollAnchor(['a', 'b', 'c'], new Set()), null);
  });

  it('respects DOM order even if a later item became visible first', () => {
    assert.equal(selectScrollAnchor(['a', 'b', 'c'], new Set(['c', 'a'])), 'a');
  });

  it('returns the only visible item', () => {
    assert.equal(selectScrollAnchor(['x', 'y', 'z'], new Set(['y'])), 'y');
  });

  it('returns the first item when it is visible', () => {
    assert.equal(selectScrollAnchor(['first', 'second'], new Set(['first', 'second'])), 'first');
  });

  it('returns null for empty ordered list', () => {
    assert.equal(selectScrollAnchor([], new Set(['a'])), null);
  });
});

describe('computeAskInputHeightValue', () => {
  it('returns pixel string for positive height', () => {
    assert.equal(computeAskInputHeightValue(48), '48px');
  });

  it('returns 0px for zero height', () => {
    assert.equal(computeAskInputHeightValue(0), '0px');
  });

  it('clamps negative to 0px', () => {
    assert.equal(computeAskInputHeightValue(-5), '0px');
  });

  it('handles large heights', () => {
    assert.equal(computeAskInputHeightValue(320), '320px');
  });
});
