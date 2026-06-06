/**
 * Streaming render throttle — decides when to flush accumulated text deltas
 * to React state for rendering, reducing O(n²) re-renders during streaming.
 *
 * Problem: Each LLM token delta triggers `setStreamingText(prev => prev + delta)`,
 * which causes Prose to re-parse the ENTIRE accumulated text via `marked.parse` +
 * `DOMPurify.sanitize`. Total work across N tokens is O(N²).
 *
 * Solution: Buffer deltas and only flush to React state every ~50ms or every
 * N pending deltas. This reduces full re-renders from O(N) to O(N / 50ms).
 * When streaming ends, one final full render of the complete text is performed.
 */

/** Mutable throttle state — stored in a React ref, not in state. */
export interface StreamingThrottleState {
  /** Timestamp of last flush (ms since epoch) */
  lastFlushMs: number;
  /** Number of deltas accumulated since last flush */
  pendingDeltas: number;
  /** Total raw text accumulated so far */
  text: string;
}

/** Configuration for the throttle policy. */
export interface StreamingThrottleOptions {
  /** Minimum time between flushes (ms). Default: 50 */
  flushIntervalMs?: number;
  /** Minimum pending deltas before a time-based flush triggers. Default: 1 */
  minDeltasForTimeFlush?: number;
  /** Number of deltas that triggers an immediate flush regardless of time. Default: 8 */
  deltaCountBurstThreshold?: number;
}

export const DEFAULT_FLUSH_INTERVAL_MS = 50;
export const DEFAULT_MIN_DELTAS_FOR_TIME_FLUSH = 1;
export const DEFAULT_DELTA_COUNT_BURST_THRESHOLD = 8;

/**
 * Create a fresh throttle state.
 */
export function createThrottleState(): StreamingThrottleState {
  return {
    lastFlushMs: 0,
    pendingDeltas: 0,
    text: '',
  };
}

/**
 * Append a text delta and decide whether a flush should be triggered.
 *
 * Flush policy:
 * - **Time-based**: If `flushIntervalMs` has elapsed since the last flush
 *   and at least `minDeltasForTimeFlush` deltas are pending, flush.
 * - **Burst**: If `deltaCountBurstThreshold` deltas have accumulated since
 *   the last flush, flush immediately regardless of time.
 *
 * @param state  Current (mutable) throttle state
 * @param delta  New text fragment from the LLM stream
 * @param nowMs  Current timestamp (Date.now())
 * @param options  Throttle configuration
 * @returns `shouldFlush` — whether the caller should push `state.text` to React state
 */
export function appendAndCheckFlush(
  state: StreamingThrottleState,
  delta: string,
  nowMs: number,
  options?: StreamingThrottleOptions,
): boolean {
  const flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const minDeltasForTimeFlush = options?.minDeltasForTimeFlush ?? DEFAULT_MIN_DELTAS_FOR_TIME_FLUSH;
  const deltaCountBurstThreshold =
    options?.deltaCountBurstThreshold ?? DEFAULT_DELTA_COUNT_BURST_THRESHOLD;

  state.text += delta;
  state.pendingDeltas += 1;

  const timeSinceLastFlush = nowMs - state.lastFlushMs;
  const shouldFlush =
    (timeSinceLastFlush >= flushIntervalMs && state.pendingDeltas >= minDeltasForTimeFlush) ||
    state.pendingDeltas >= deltaCountBurstThreshold;

  if (shouldFlush) {
    state.pendingDeltas = 0;
    state.lastFlushMs = nowMs;
  }

  return shouldFlush;
}

/**
 * Force-flush: return the accumulated text and reset pending counters.
 * Called when streaming ends to ensure the final render includes all text.
 */
export function forceFlush(state: StreamingThrottleState): string {
  state.pendingDeltas = 0;
  return state.text;
}

/**
 * Reset the throttle state for a new conversation.
 */
export function resetThrottleState(state: StreamingThrottleState): void {
  state.lastFlushMs = 0;
  state.pendingDeltas = 0;
  state.text = '';
}
