import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteConcept,
  fetchConceptById,
  fetchSourceById,
  flagConceptIncorrect,
  getRepairStatus,
  updateSourceContent,
} from './api-client';

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

test('api-client native request paths lock the private cache on 401', async () => {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  localStorage.setItem('compound:offline-access', '1');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      location: { origin: 'https://compound.example' },
    },
  });
  globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;

  try {
    await assert.rejects(() => getRepairStatus('run-1'), /Unauthorized/);
    assert.equal(localStorage.getItem('compound:offline-access'), null);
    assert.equal(localStorage.getItem('compound:local-cache-lock'), '1');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});

test('source and concept mutation paths lock the private cache on 401', async () => {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  localStorage.setItem('compound:offline-access', '1');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      location: { origin: 'https://compound.example' },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.fetch = (async () => new Response('Unauthorized', { status: 401 })) as typeof fetch;

  try {
    await assert.rejects(
      () => updateSourceContent({ id: 's-1', rawContent: 'draft', expectedRevision: 1 }),
      /认证失败/,
    );
    assert.equal(localStorage.getItem('compound:local-cache-lock'), '1');
    assert.equal(localStorage.getItem('compound:offline-access'), null);

    localStorage.setItem('compound:offline-access', '1');
    localStorage.removeItem('compound:local-cache-lock');
    await assert.rejects(
      () => flagConceptIncorrect({ id: 'c-1', expectedRevision: 1 }),
      /认证失败/,
    );
    assert.equal(localStorage.getItem('compound:local-cache-lock'), '1');

    localStorage.setItem('compound:offline-access', '1');
    localStorage.removeItem('compound:local-cache-lock');
    await assert.rejects(() => deleteConcept({ id: 'c-1', expectedRevision: 1 }), /认证失败/);
    assert.equal(localStorage.getItem('compound:local-cache-lock'), '1');
    assert.equal(localStorage.getItem('compound:offline-access'), null);

    localStorage.setItem('compound:offline-access', '1');
    localStorage.removeItem('compound:local-cache-lock');
    await assert.rejects(() => fetchSourceById('s-1'), /认证失败/);
    assert.equal(localStorage.getItem('compound:local-cache-lock'), '1');

    localStorage.setItem('compound:offline-access', '1');
    localStorage.removeItem('compound:local-cache-lock');
    await assert.rejects(() => fetchConceptById('c-1'), /认证失败/);
    assert.equal(localStorage.getItem('compound:local-cache-lock'), '1');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
});
