import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

function computeConceptIdsHash(concepts: Array<{ id: string; updatedAt: number }>): string {
  const payload = concepts
    .map((c) => `${c.id}|${c.updatedAt}`)
    .sort()
    .join('\n');
  return createHash('sha1').update(payload).digest('hex').slice(0, 20);
}

describe('computeConceptIdsHash', () => {
  it('returns consistent hash for same input', () => {
    const concepts = [
      { id: 'c-1', updatedAt: 1000 },
      { id: 'c-2', updatedAt: 2000 },
    ];
    const hash1 = computeConceptIdsHash(concepts);
    const hash2 = computeConceptIdsHash(concepts);
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 20);
  });

  it('changes hash when concept ids differ', () => {
    const a = [{ id: 'c-1', updatedAt: 1000 }];
    const b = [{ id: 'c-2', updatedAt: 1000 }];
    assert.notEqual(computeConceptIdsHash(a), computeConceptIdsHash(b));
  });

  it('changes hash when updatedAt differs', () => {
    const a = [{ id: 'c-1', updatedAt: 1000 }];
    const b = [{ id: 'c-1', updatedAt: 2000 }];
    assert.notEqual(computeConceptIdsHash(a), computeConceptIdsHash(b));
  });

  it('is order-independent', () => {
    const a = [
      { id: 'c-1', updatedAt: 1000 },
      { id: 'c-2', updatedAt: 2000 },
    ];
    const b = [
      { id: 'c-2', updatedAt: 2000 },
      { id: 'c-1', updatedAt: 1000 },
    ];
    assert.equal(computeConceptIdsHash(a), computeConceptIdsHash(b));
  });

  it('handles empty array', () => {
    const hash = computeConceptIdsHash([]);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 20);
  });
});
