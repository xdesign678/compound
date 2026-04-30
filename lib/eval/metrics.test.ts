import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregate,
  diffAggregates,
  firstMatchRank,
  scoreItem,
  type GoldenItem,
  type ItemScore,
  type QueryRunResult,
  type RetrievedConcept,
} from './metrics';

const concepts: RetrievedConcept[] = [
  { id: 'c-1', title: '认知负荷' },
  { id: 'c-2', title: '用户体验' },
  { id: 'c-3', title: 'RAG 检索' },
];

test('firstMatchRank finds first id-matched concept', () => {
  assert.equal(firstMatchRank(concepts, ['c-2'], []), 2);
});

test('firstMatchRank falls back to title fragment match', () => {
  assert.equal(firstMatchRank(concepts, [], ['rag']), 3);
});

test('firstMatchRank returns 0 when nothing matches', () => {
  assert.equal(firstMatchRank(concepts, ['c-x'], ['nope']), 0);
});

test('scoreItem computes hit@k and MRR for first-rank match', () => {
  const item: GoldenItem = {
    id: 'q1',
    question: '?',
    expectedConceptIds: ['c-1'],
    expectedKeywords: ['认知', '负荷'],
  };
  const result: QueryRunResult = {
    question: '?',
    citedConceptIds: ['c-1'],
    answer: '答案讨论了认知负荷的来源。',
    latencyMs: 1200,
  };
  const score = scoreItem(item, result, concepts);
  assert.equal(score.hitAt1, 1);
  assert.equal(score.hitAt3, 1);
  assert.equal(score.hitAt8, 1);
  assert.equal(score.mrr, 1);
  assert.equal(score.keywordRecall, 1);
});

test('scoreItem marks miss when expected concept missing', () => {
  const item: GoldenItem = {
    id: 'q2',
    question: '?',
    expectedConceptIds: ['c-99'],
  };
  const result: QueryRunResult = {
    question: '?',
    citedConceptIds: ['c-1'],
    answer: 'noop',
    latencyMs: 800,
  };
  const score = scoreItem(item, result, concepts);
  assert.equal(score.hitAt1, 0);
  assert.equal(score.mrr, 0);
});

test('scoreItem skips hit metrics when no expectations configured', () => {
  const item: GoldenItem = { id: 'q3', question: '?' };
  const result: QueryRunResult = {
    question: '?',
    citedConceptIds: [],
    answer: 'x',
    latencyMs: 500,
  };
  const score = scoreItem(item, result, concepts);
  assert.equal(score.hitSkipped, true);
  assert.equal(score.keywordSkipped, true);
});

test('aggregate excludes errored items from averages', () => {
  const scores: ItemScore[] = [
    {
      id: 'a',
      question: '?',
      hitAt1: 1,
      hitAt3: 1,
      hitAt8: 1,
      mrr: 1,
      keywordRecall: 1,
      hitSkipped: false,
      keywordSkipped: false,
      latencyMs: 1000,
    },
    {
      id: 'b',
      question: '?',
      hitAt1: 0,
      hitAt3: 0,
      hitAt8: 0,
      mrr: 0,
      keywordRecall: 0,
      hitSkipped: false,
      keywordSkipped: false,
      latencyMs: 0,
      error: 'boom',
    },
  ];
  const agg = aggregate(scores);
  assert.equal(agg.count, 2);
  assert.equal(agg.errored, 1);
  assert.equal(agg.hitAt1, 1);
});

test('diffAggregates flags regressions and improvements', () => {
  const before = {
    count: 5,
    errored: 0,
    hitAt1: 0.6,
    hitAt3: 0.8,
    hitAt8: 0.9,
    mrr: 0.7,
    keywordRecall: 0.5,
    latency: { avg: 1000, p95: 2000 },
  };
  const after = { ...before, hitAt1: 0.7, latency: { avg: 1500, p95: 2000 } };
  const diff = diffAggregates(before, after);
  const hit1 = diff.find((d) => d.metric === 'hit@1');
  const lat = diff.find((d) => d.metric === 'avg latency (ms)');
  assert.equal(hit1?.direction, 'good');
  assert.equal(lat?.direction, 'bad');
});
