import test from 'node:test';
import assert from 'node:assert/strict';

import { clearAdminToken, saveAdminToken } from './admin-auth-client';

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

test('saveAdminToken creates an httpOnly admin session through the server', async () => {
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
  } finally {
    mock.restore();
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
  const removedKeys: string[] = [];
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        removeItem(key: string) {
          removedKeys.push(key);
        },
      },
    },
  });

  const mock = withMockFetch(() => new Response(JSON.stringify({ authenticated: false })));
  try {
    await clearAdminToken();

    assert.equal(mock.calls.length, 1);
    assert.equal(String(mock.calls[0].input), '/api/auth/session');
    assert.equal(mock.calls[0].init?.method, 'DELETE');
    assert.equal(mock.calls[0].init?.credentials, 'same-origin');
    assert.deepEqual(removedKeys, ['compound_admin_token']);
  } finally {
    mock.restore();
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
});
