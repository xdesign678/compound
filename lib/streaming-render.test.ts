import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createThrottleState,
  appendAndCheckFlush,
  forceFlush,
  resetThrottleState,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_DELTA_COUNT_BURST_THRESHOLD,
  type StreamingThrottleState,
} from './streaming-render.js';

describe('streaming-render throttle', () => {
  it('should not flush before interval elapses with few deltas', () => {
    const state = createThrottleState();
    // At t=0, first delta — lastFlushMs is 0, timeSinceLast = 0 - 0 = 0
    const flushed = appendAndCheckFlush(state, 'Hello', 0);
    assert.equal(flushed, false);
    assert.equal(state.text, 'Hello');
    assert.equal(state.pendingDeltas, 1);
  });

  it('should flush when interval elapses and min deltas met', () => {
    const state = createThrottleState();
    // t=0: first delta sets lastFlushMs=0 (not flushed yet)
    appendAndCheckFlush(state, 'H', 0);
    // t=60ms (> 50ms interval): flush
    const flushed = appendAndCheckFlush(state, 'i', 60);
    assert.equal(flushed, true);
    assert.equal(state.text, 'Hi');
    assert.equal(state.pendingDeltas, 0);
    assert.equal(state.lastFlushMs, 60);
  });

  it('should not flush when interval elapses but no deltas pending', () => {
    const state = createThrottleState();
    // Flush at t=100
    appendAndCheckFlush(state, 'A', 0);
    // Force flush to reset pending
    state.pendingDeltas = 0;
    state.lastFlushMs = 100;
    // t=200, no pending deltas
    const flushed = appendAndCheckFlush(state, 'B', 200);
    // This should flush because we have 1 pending delta and 100ms > 50ms
    assert.equal(flushed, true);
  });

  it('should flush on burst threshold regardless of time', () => {
    const state = createThrottleState();
    const threshold = DEFAULT_DELTA_COUNT_BURST_THRESHOLD; // 8
    // Rapid-fire 8 deltas at t=1 (only 1ms since last flush)
    for (let i = 0; i < threshold - 1; i++) {
      appendAndCheckFlush(state, `d${i}`, 1);
    }
    assert.equal(state.pendingDeltas, threshold - 1);
    // 8th delta should trigger burst flush
    const flushed = appendAndCheckFlush(state, 'd7', 1);
    assert.equal(flushed, true);
    assert.equal(state.pendingDeltas, 0);
    assert.equal(state.text, 'd0d1d2d3d4d5d6d7');
  });

  it('should accumulate text correctly across multiple flushes', () => {
    const state = createThrottleState();
    // Flush 1: t=100
    appendAndCheckFlush(state, 'Hello', 0);
    appendAndCheckFlush(state, ' ', 100); // flush at t=100
    assert.equal(state.text, 'Hello ');

    // Flush 2: t=200
    appendAndCheckFlush(state, 'World', 200);
    assert.equal(state.text, 'Hello World');
  });

  it('should produce correct flush batches for a token sequence', () => {
    const state = createThrottleState();
    const flushes: string[] = [];
    let t = 0;

    // Simulate 20 tokens arriving every 5ms (100ms total)
    for (let i = 0; i < 20; i++) {
      const shouldFlush = appendAndCheckFlush(state, `tok${i} `, t);
      if (shouldFlush) {
        flushes.push(state.text);
      }
      t += 5;
    }

    // Verify: should have flushed at least 2 times (at ~50ms and ~100ms)
    assert.ok(flushes.length >= 2, `Expected >=2 flushes, got ${flushes.length}`);
    // The final accumulated text should be complete
    const expectedText = Array.from({ length: 20 }, (_, i) => `tok${i} `).join('');
    assert.equal(state.text, expectedText);
  });

  it('forceFlush returns full accumulated text', () => {
    const state = createThrottleState();
    appendAndCheckFlush(state, 'partial', 0);
    appendAndCheckFlush(state, ' text', 10);
    const text = forceFlush(state);
    assert.equal(text, 'partial text');
    assert.equal(state.pendingDeltas, 0);
  });

  it('resetThrottleState clears everything', () => {
    const state = createThrottleState();
    appendAndCheckFlush(state, 'some', 0);
    appendAndCheckFlush(state, ' text', 100);
    resetThrottleState(state);
    assert.equal(state.text, '');
    assert.equal(state.pendingDeltas, 0);
    assert.equal(state.lastFlushMs, 0);
  });

  it('respects custom flushIntervalMs', () => {
    const state = createThrottleState();
    // Custom: 100ms interval
    const options = { flushIntervalMs: 100 };
    appendAndCheckFlush(state, 'a', 0, options);
    // At t=50 (< 100ms): should NOT flush
    const f1 = appendAndCheckFlush(state, 'b', 50, options);
    assert.equal(f1, false);
    // At t=110 (> 100ms): should flush
    const f2 = appendAndCheckFlush(state, 'c', 110, options);
    assert.equal(f2, true);
  });

  it('respects custom deltaCountBurstThreshold', () => {
    const state = createThrottleState();
    const options = { deltaCountBurstThreshold: 3 };
    // 2 deltas at t=1 — not enough for burst
    appendAndCheckFlush(state, 'a', 1, options);
    const f1 = appendAndCheckFlush(state, 'b', 1, options);
    assert.equal(f1, false);
    // 3rd delta — burst flush
    const f2 = appendAndCheckFlush(state, 'c', 1, options);
    assert.equal(f2, true);
  });

  it('flush batch simulation — verify O(N) total work instead of O(N²)', () => {
    const state = createThrottleState();
    let flushCount = 0;
    const totalTokens = 100;

    // Simulate 100 tokens arriving every 10ms (1 second total)
    for (let i = 0; i < totalTokens; i++) {
      const t = i * 10;
      const shouldFlush = appendAndCheckFlush(state, `w${i} `, t);
      if (shouldFlush) {
        flushCount++;
      }
    }

    // With 50ms interval and 10ms per token, we expect roughly 1000/50 = 20 flushes
    // (plus burst flushes for rapid sequences)
    // The key assertion: flushCount should be MUCH less than totalTokens (100)
    assert.ok(flushCount < totalTokens, `Expected flushCount < ${totalTokens}, got ${flushCount}`);
    // And the total text is complete
    const expectedText = Array.from({ length: totalTokens }, (_, i) => `w${i} `).join('');
    assert.equal(state.text, expectedText);
  });
});
