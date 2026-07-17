import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHttpUrl, requireHttpUrl } from './safe-url';

test('normalizes only http and https source URLs', () => {
  assert.equal(normalizeHttpUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(normalizeHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeHttpUrl('javascript://example.com/%0Aalert(1)'), null);
  assert.equal(normalizeHttpUrl('data:text/html,hello'), null);
  assert.equal(normalizeHttpUrl('/relative'), null);
});

test('requireHttpUrl rejects dangerous protocols and permits blank values', () => {
  assert.equal(requireHttpUrl('  '), undefined);
  assert.throws(() => requireHttpUrl('javascript:alert(1)'), /只支持/);
});
