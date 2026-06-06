import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePositiveInt,
  clampLimit,
  MAX_CONCEPT_LIMIT,
  MAX_CHUNK_LIMIT,
  MAX_TOPIC_LIMIT,
  MAX_DAYS,
} from './clamp';

// --- parsePositiveInt ---

test('parsePositiveInt: valid integer within range', () => {
  assert.equal(parsePositiveInt(5, 100), 5);
  assert.equal(parsePositiveInt(1, 100), 1);
  assert.equal(parsePositiveInt(100, 100), 100);
});

test('parsePositiveInt: string integer within range', () => {
  assert.equal(parsePositiveInt('5', 100), 5);
  assert.equal(parsePositiveInt('1', 100), 1);
  assert.equal(parsePositiveInt('100', 100), 100);
});

test('parsePositiveInt: clamps to max', () => {
  assert.equal(parsePositiveInt(200, 100), 100);
  assert.equal(parsePositiveInt(999999, 100), 100);
  assert.equal(parsePositiveInt('200', 100), 100);
});

test('parsePositiveInt: returns undefined for NaN-producing inputs', () => {
  assert.equal(parsePositiveInt('abc', 100), undefined);
  assert.equal(parsePositiveInt('', 100), undefined);
  assert.equal(parsePositiveInt('  ', 100), undefined);
  assert.equal(parsePositiveInt(NaN, 100), undefined);
  assert.equal(parsePositiveInt(Infinity, 100), undefined);
  assert.equal(parsePositiveInt(-Infinity, 100), undefined);
  assert.equal(parsePositiveInt(null, 100), undefined);
  assert.equal(parsePositiveInt(undefined, 100), undefined);
  assert.equal(parsePositiveInt(true, 100), undefined);
  assert.equal(parsePositiveInt({}, 100), undefined);
  assert.equal(parsePositiveInt([], 100), undefined);
});

test('parsePositiveInt: returns undefined for non-integer numbers', () => {
  assert.equal(parsePositiveInt(3.5, 100), undefined);
  assert.equal(parsePositiveInt('3.5', 100), undefined);
  assert.equal(parsePositiveInt(0.9, 100), undefined);
});

test('parsePositiveInt: returns undefined for zero and negative integers', () => {
  assert.equal(parsePositiveInt(0, 100), undefined);
  assert.equal(parsePositiveInt(-1, 100), undefined);
  assert.equal(parsePositiveInt(-5, 100), undefined);
  assert.equal(parsePositiveInt('0', 100), undefined);
  assert.equal(parsePositiveInt('-5', 100), undefined);
});

// --- clampLimit (same semantics as parsePositiveInt, just an alias) ---

test('clampLimit: clamps large valid values', () => {
  assert.equal(clampLimit(100000000, MAX_CONCEPT_LIMIT), MAX_CONCEPT_LIMIT);
  assert.equal(clampLimit(500, MAX_CHUNK_LIMIT), MAX_CHUNK_LIMIT);
  assert.equal(clampLimit(9999, MAX_TOPIC_LIMIT), MAX_TOPIC_LIMIT);
  assert.equal(clampLimit(365, MAX_DAYS), MAX_DAYS);
});

test('clampLimit: returns undefined for non-numeric', () => {
  assert.equal(clampLimit('abc', MAX_CONCEPT_LIMIT), undefined);
  assert.equal(clampLimit(null, 100), undefined);
});

// --- Constants ---

test('exported constants have expected values', () => {
  assert.equal(MAX_CONCEPT_LIMIT, 100);
  assert.equal(MAX_CHUNK_LIMIT, 50);
  assert.equal(MAX_TOPIC_LIMIT, 200);
  assert.equal(MAX_DAYS, 90);
});
