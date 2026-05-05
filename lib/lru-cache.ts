/**
 * Simple LRU (Least Recently Used) cache backed by a JavaScript Map.
 *
 * Map iterates in insertion order, so on every `get` / `set` we delete and
 * re-insert the key to move it to the "most recently used" position.
 * When the cache exceeds `maxSize`, the oldest entry (first iteration key)
 * is evicted.
 */
export class LRUMap<K, V> {
  private readonly _map = new Map<K, V>();
  private readonly _maxSize: number;

  constructor(maxSize: number) {
    if (maxSize < 1) throw new RangeError('LRUMap maxSize must be >= 1');
    this._maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this._map.get(key);
    if (value === undefined) return undefined;
    // Move to most-recently-used position
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Evict least-recently-used (first key in iteration order)
      const lruKey = this._map.keys().next().value;
      if (lruKey !== undefined) {
        this._map.delete(lruKey);
      }
    }
    this._map.set(key, value);
  }

  has(key: K): boolean {
    return this._map.has(key);
  }

  get size(): number {
    return this._map.size;
  }

  clear(): void {
    this._map.clear();
  }
}
