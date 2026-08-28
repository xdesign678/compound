import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyHttpAuthLock,
  canReadPrivateCache,
  checkAdminSession,
  clearAdminToken,
  resolvePrivateCacheAccess,
  saveAdminToken,
} from './admin-auth-client';

type FetchCall = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

function withMockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const previousFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return handler(input, init);
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

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

function withMockWindow() {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
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

test('saveAdminToken creates an httpOnly admin session through the server', async () => {
  const browser = withMockWindow();
  const mock = withMockFetch(
    () => new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
  );
  try {
    await saveAdminToken('  secret-token  ');

    assert.equal(mock.calls.length, 1);
    assert.equal(String(mock.calls[0].input), '/api/auth/session');
    assert.equal(mock.calls[0].init?.method, 'POST');
    assert.equal(mock.calls[0].init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(mock.calls[0].init?.body)), {
      token: 'secret-token',
    });
    assert.equal(browser.localStorage.getItem('compound:offline-access'), '1');
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), null);
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('saveAdminToken rejects invalid admin tokens with a useful message', async () => {
  const mock = withMockFetch(
    () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
  );
  try {
    await assert.rejects(() => saveAdminToken('bad-token'), /访问保护密钥无效/);
  } finally {
    mock.restore();
  }
});

test('clearAdminToken clears the server session and legacy local token', async () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound_admin_token', 'legacy');
  browser.localStorage.setItem('compound:offline-access', '1');

  const mock = withMockFetch(() => new Response(JSON.stringify({ authenticated: false })));
  try {
    await clearAdminToken();

    assert.equal(mock.calls.length, 1);
    assert.equal(String(mock.calls[0].input), '/api/auth/session');
    assert.equal(mock.calls[0].init?.method, 'DELETE');
    assert.equal(mock.calls[0].init?.credentials, 'same-origin');
    assert.equal(browser.localStorage.getItem('compound_admin_token'), null);
    assert.equal(browser.localStorage.getItem('compound:offline-access'), null);
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), '1');
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('checkAdminSession records a verified grant for later offline reading', async () => {
  const browser = withMockWindow();
  const mock = withMockFetch(
    () => new Response(JSON.stringify({ authenticated: true }), { status: 200 }),
  );
  try {
    assert.equal(await checkAdminSession(), true);
    assert.equal(browser.localStorage.getItem('compound:offline-access'), '1');
    assert.equal(mock.calls[0].init?.cache, 'no-store');
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('canReadPrivateCache keeps an explicit logout locked without probing the server', async () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound:offline-access', '1');
  browser.localStorage.setItem('compound:local-cache-lock', '1');
  const mock = withMockFetch(() => {
    throw new Error('fetch should not run while locally locked');
  });
  try {
    assert.equal(await canReadPrivateCache(), false);
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('canReadPrivateCache falls back to the last verified grant during a network outage', async () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound:offline-access', '1');
  const mock = withMockFetch(() => {
    throw new Error('offline');
  });
  try {
    assert.equal(await canReadPrivateCache(), true);
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('checkAdminSession locks the cache on 401 and does not allow offline fallback', async () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound:offline-access', '1');
  const mock = withMockFetch(() => new Response('Unauthorized', { status: 401 }));
  try {
    assert.equal(await checkAdminSession(), false);
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), '1');
    assert.equal(await canReadPrivateCache(), false);
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('checkAdminSession treats 5xx as unavailable and keeps a prior offline grant', async () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound:offline-access', '1');
  const mock = withMockFetch(() => new Response('nope', { status: 503 }));
  try {
    assert.equal(await checkAdminSession(), null);
    assert.equal(await canReadPrivateCache(), true);
    assert.deepEqual(await resolvePrivateCacheAccess(), { kind: 'granted', live: false });
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('timeout or 5xx on a new device is unavailable, not an authoritative logout', async () => {
  const browser = withMockWindow();
  const mock = withMockFetch(() => new Response('nope', { status: 503 }));
  try {
    assert.equal(await checkAdminSession(), null);
    assert.equal(await canReadPrivateCache(), false);
    const decision = await resolvePrivateCacheAccess();
    assert.equal(decision.kind, 'unavailable');
    if (decision.kind === 'unavailable') assert.equal(decision.reason, 'server_error');
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('session abort is classified as timeout rather than revoke', async () => {
  const browser = withMockWindow();
  const mock = withMockFetch(() => {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    throw error;
  });
  try {
    const decision = await resolvePrivateCacheAccess();
    assert.equal(decision.kind, 'unavailable');
    if (decision.kind === 'unavailable') assert.equal(decision.reason, 'timeout');
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), null);
  } finally {
    mock.restore();
    browser.restore();
  }
});

test('authoritative 401/403 lock the private cache; timeout and 5xx do not', () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound:offline-access', '1');
  try {
    assert.equal(applyHttpAuthLock(503), false);
    assert.equal(browser.localStorage.getItem('compound:offline-access'), '1');
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), null);

    assert.equal(applyHttpAuthLock(401), true);
    assert.equal(browser.localStorage.getItem('compound:offline-access'), null);
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), '1');
  } finally {
    browser.restore();
  }
});

test('403 also drops the offline grant', () => {
  const browser = withMockWindow();
  browser.localStorage.setItem('compound:offline-access', '1');
  try {
    assert.equal(applyHttpAuthLock(403), true);
    assert.equal(browser.localStorage.getItem('compound:local-cache-lock'), '1');
  } finally {
    browser.restore();
  }
});
