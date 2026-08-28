export const WIKI_REMOTE_SEARCH_DEBOUNCE_MS = 250;

export function createStaleRequestGuard() {
  let generation = 0;
  return {
    next(): number {
      generation += 1;
      return generation;
    },
    isCurrent(id: number): boolean {
      return id === generation;
    },
  };
}

export function scheduleDebouncedCallback(
  delayMs: number,
  callback: () => void,
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
): ReturnType<typeof setTimeout> {
  return setTimer(callback, delayMs);
}
