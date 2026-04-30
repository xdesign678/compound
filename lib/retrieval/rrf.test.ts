import test from 'node:test';
import assert from 'node:assert/strict';

import { reciprocalRankFusion } from './rrf';

interface Doc {
  id: string;
}
const id = (d: Doc) => d.id;

test('rrf merges two ranked lists, consensus wins', () => {
  const fts: Doc[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const vec: Doc[] = [{ id: 'b' }, { id: 'a' }, { id: 'd' }];

  const fused = reciprocalRankFusion<Doc>([
    { name: 'fts', items: fts, getId: id },
    { name: 'vec', items: vec, getId: id },
  ]);

  // a appears at rank 0 in fts, rank 1 in vec → consensus
  // b appears at rank 1 in fts, rank 0 in vec → consensus, similar weight
  // Top 2 must be {a, b} in some order; c & d trail
  const top2 = fused
    .slice(0, 2)
    .map((f) => f.id)
    .sort();
  assert.deepEqual(top2, ['a', 'b']);
  assert.equal(fused.length, 4);
});

test('rrf weight scales contribution', () => {
  const a: Doc[] = [{ id: 'x' }];
  const b: Doc[] = [{ id: 'y' }];

  const fused = reciprocalRankFusion<Doc>([
    { name: 'a', items: a, getId: id, weight: 0.1 },
    { name: 'b', items: b, getId: id, weight: 1 },
  ]);

  assert.equal(fused[0].id, 'y');
  assert.equal(fused[1].id, 'x');
});

test('rrf topK truncates output', () => {
  const items: Doc[] = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}` }));
  const fused = reciprocalRankFusion<Doc>([{ name: 'one', items, getId: id }], { topK: 3 });
  assert.equal(fused.length, 3);
});

test('rrf records per-source contributions', () => {
  const fused = reciprocalRankFusion<Doc>([
    { name: 'fts', items: [{ id: 'a' }], getId: id },
    { name: 'vec', items: [{ id: 'a' }], getId: id },
  ]);
  assert.equal(fused.length, 1);
  assert.ok(fused[0].contributions.fts > 0);
  assert.ok(fused[0].contributions.vec > 0);
});
