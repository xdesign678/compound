import test from 'node:test';
import assert from 'node:assert/strict';

import type { CompoundDB } from './db';
import { clearPrivateOfflineCache } from './private-cache';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

test('clearPrivateOfflineCache removes all IndexedDB knowledge tables and private browser data', async () => {
  const cleared: string[] = [];
  const table = (name: string) => ({
    clear: async () => {
      cleared.push(name);
    },
  });
  const sources = table('sources');
  const concepts = table('concepts');
  const activity = table('activity');
  const askHistory = table('askHistory');
  const transactionTables: unknown[] = [];
  const database = {
    sources,
    concepts,
    activity,
    askHistory,
    async transaction(_mode: string, tables: unknown[], scope: () => Promise<void>) {
      transactionTables.push(...tables);
      await scope();
    },
  } as unknown as CompoundDB;

  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  localStorage.setItem('compound_recent_command_items', 'private titles');
  localStorage.setItem('compound_note_draft_123', 'private draft');
  localStorage.setItem('compound_theme', 'dark');
  sessionStorage.setItem('compound_llm_config', 'private credential');
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, sessionStorage },
  });

  try {
    await clearPrivateOfflineCache(database);

    assert.deepEqual(cleared.sort(), ['activity', 'askHistory', 'concepts', 'sources']);
    assert.deepEqual(transactionTables, [sources, concepts, activity, askHistory]);
    assert.equal(localStorage.getItem('compound_recent_command_items'), null);
    assert.equal(localStorage.getItem('compound_note_draft_123'), null);
    assert.equal(sessionStorage.getItem('compound_llm_config'), null);
    assert.equal(localStorage.getItem('compound_theme'), 'dark');
  } finally {
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});
