import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEmitCompleteQueryDone,
  collectCitedProvenance,
  filterRetrievalEligibleConcepts,
  MAX_PROVENANCE_QUOTE_CHARS,
} from './provenance';

test('collectCitedProvenance only emits ids that exist on provided objects', () => {
  const links = collectCitedProvenance({
    citedConceptIds: ['c-1', 'c-missing', 'c-2'],
    concepts: [
      { id: 'c-1', sources: ['s-1', 's-ghost'] },
      { id: 'c-2', sources: ['s-2'] },
    ],
    chunks: [
      { id: 'ch-1', sourceId: 's-1', content: 'alpha evidence sentence about the topic' },
      { id: 'ch-unrelated', sourceId: 's-other', content: 'unrelated chunk' },
    ],
    evidence: [
      {
        id: 'ev-1',
        conceptId: 'c-1',
        sourceId: 's-1',
        chunkId: 'ch-1',
        quote: 'alpha evidence sentence',
      },
      {
        id: 'ev-unrelated',
        conceptId: 'c-other',
        sourceId: 's-other',
        chunkId: 'ch-unrelated',
        quote: 'nope',
      },
    ],
    knownSourceIds: ['s-1', 's-2'],
    knownChunkIds: ['ch-1', 'ch-unrelated'],
    knownEvidenceIds: ['ev-1', 'ev-unrelated'],
  });

  assert.deepEqual(links.citedConceptIds, ['c-1', 'c-2']);
  assert.deepEqual(links.citedSourceIds, ['s-1', 's-2']);
  assert.deepEqual(links.citedChunkIds, ['ch-1']);
  assert.deepEqual(links.citedEvidenceIds, ['ev-1']);
  assert.equal(links.quotes.length, 1);
  assert.equal(links.quotes[0]?.sourceId, 's-1');
  assert.equal(links.quotes[0]?.chunkId, 'ch-1');
  assert.equal(links.quotes[0]?.evidenceId, 'ev-1');
  assert.ok((links.quotes[0]?.quote.length || 0) <= MAX_PROVENANCE_QUOTE_CHARS);
});

test('collectCitedProvenance fills missing evidence layer from connected chunks', () => {
  const links = collectCitedProvenance({
    citedConceptIds: ['c-1'],
    concepts: [{ id: 'c-1', sources: ['s-1'] }],
    chunks: [{ id: 'ch-1', sourceId: 's-1', content: 'connected chunk quote' }],
    evidence: [],
    knownSourceIds: ['s-1'],
  });
  assert.deepEqual(links.citedSourceIds, ['s-1']);
  assert.deepEqual(links.citedChunkIds, ['ch-1']);
  assert.deepEqual(links.citedEvidenceIds, []);
  assert.equal(links.quotes[0]?.chunkId, 'ch-1');
  assert.match(links.quotes[0]?.quote || '', /connected chunk/);
});

test('collectCitedProvenance never invents guessed ids', () => {
  const links = collectCitedProvenance({
    citedConceptIds: ['c-1'],
    concepts: [{ id: 'c-1', sources: ['s-1'] }],
    chunks: [],
    evidence: [],
    knownSourceIds: ['s-1'],
  });
  assert.deepEqual(links.citedSourceIds, ['s-1']);
  assert.deepEqual(links.citedChunkIds, []);
  assert.deepEqual(links.citedEvidenceIds, []);
  assert.deepEqual(links.quotes, []);
});

test('canEmitCompleteQueryDone is false after abort', () => {
  const controller = new AbortController();
  assert.equal(canEmitCompleteQueryDone(controller.signal), true);
  controller.abort();
  assert.equal(canEmitCompleteQueryDone(controller.signal), false);
});

test('filterRetrievalEligibleConcepts drops draft and rejected rows', () => {
  const kept = filterRetrievalEligibleConcepts([
    { id: 'a', knowledgeStatus: 'approved' },
    { id: 'b', knowledgeStatus: 'draft' },
    { id: 'c', knowledgeStatus: 'rejected' },
    { id: 'd' },
  ]);
  assert.deepEqual(
    kept.map((item) => item.id),
    ['a', 'd'],
  );
});
