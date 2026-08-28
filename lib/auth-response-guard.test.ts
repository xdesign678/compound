import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchCompoundPrivateApi,
  guardCompoundPrivateApiResponse,
  isCompoundPrivateApiUrl,
} from './auth-response-guard';

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

function installBrowser() {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      location: { origin: 'https://compound.example' },
    },
  });
  return {
    localStorage,
    restore() {
      if (previousWindowDescriptor) {
        Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    },
  };
}

function installFetch(
  handler: (input: string | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ input: string | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const guardedInput = input as string | URL;
    calls.push({ input: guardedInput, init });
    return handler(guardedInput, init);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

test('accepts only root-relative or browser-same-origin /api/ URLs', () => {
  const browser = installBrowser();
  try {
    assert.equal(isCompoundPrivateApiUrl('/api/data/snapshot?cursor=1'), true);
    assert.equal(isCompoundPrivateApiUrl('https://compound.example/api/settings/models'), true);
    assert.equal(isCompoundPrivateApiUrl('/api/../public'), false);
    assert.equal(isCompoundPrivateApiUrl('/settings'), false);
    assert.equal(isCompoundPrivateApiUrl('https://api.github.com/api/repos'), false);
    assert.equal(isCompoundPrivateApiUrl('https://llm.example/api/chat'), false);
  } finally {
    browser.restore();
  }
});

test('401 and 403 clear an old offline grant and lock the private cache', async () => {
  for (const status of [401, 403]) {
    const browser = installBrowser();
    browser.localStorage.setItem('compound:offline-access', '1');
    const mock = installFetch(() => new Response('rejected', { status }));
    try {
      const response = await fetchCompoundPrivateApi('/api/auth/session');
      assert.equal(response.status, status);
      assert.equal(browser.localStorage.getItem('compound:offline-access'), null);
      assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), '1');
    } finally {
      mock.restore();
      browser.restore();
    }
  }
});

test('5xx, timeout, and network failure keep the existing offline grant unlocked', async () => {
  const browser = installBrowser();
  browser.localStorage.setItem('compound:offline-access', '1');
  try {
    const serverError = installFetch(() => new Response('unavailable', { status: 503 }));
    try {
      await fetchCompoundPrivateApi('/api/data/snapshot');
      assert.equal(browser.localStorage.getItem('compound:offline-access'), '1');
      assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), null);
    } finally {
      serverError.restore();
    }

    for (const error of [
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
      new TypeError('fetch failed'),
    ]) {
      const failedFetch = installFetch(() => {
        throw error;
      });
      try {
        await assert.rejects(() => fetchCompoundPrivateApi('/api/data/snapshot'));
        assert.equal(browser.localStorage.getItem('compound:offline-access'), '1');
        assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), null);
      } finally {
        failedFetch.restore();
      }
    }
  } finally {
    browser.restore();
  }
});

test('external GitHub and LLM 401 responses never lock Compound private data', () => {
  const browser = installBrowser();
  browser.localStorage.setItem('compound:offline-access', '1');
  try {
    for (const url of ['https://api.github.com/repos/acme/repo', 'https://llm.example/v1/chat']) {
      assert.throws(
        () => guardCompoundPrivateApiResponse(url, new Response('rejected', { status: 401 })),
        /only accepts relative or same-origin/,
      );
      assert.equal(browser.localStorage.getItem('compound:offline-access'), '1');
      assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), null);
    }
  } finally {
    browser.restore();
  }
});

test('external URLs are rejected before native fetch is called', async () => {
  const browser = installBrowser();
  const mock = installFetch(() => new Response('should not run', { status: 401 }));
  try {
    await assert.rejects(
      () => fetchCompoundPrivateApi('https://api.github.com/repos/acme/repo'),
      /only accepts relative or same-origin/,
    );
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
    browser.restore();
  }
});
