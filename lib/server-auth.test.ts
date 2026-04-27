import test from 'node:test';
import assert from 'node:assert/strict';

import { getAdminToken, isAuthorizedRequest, requireAdmin } from './server-auth';

async function withEnv<T>(
  values: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('reads trimmed admin token from env', { concurrency: false }, async () => {
  await withEnv(
    {
      COMPOUND_ADMIN_TOKEN: '  "secret"  ',
      ADMIN_TOKEN: undefined,
    },
    () => {
      assert.equal(getAdminToken(), 'secret');
    },
  );
});

test('authorizes requests with x-compound-admin-token', { concurrency: false }, async () => {
  await withEnv(
    {
      COMPOUND_ADMIN_TOKEN: 'secret',
      ADMIN_TOKEN: undefined,
      NODE_ENV: 'production',
    },
    () => {
      const req = new Request('http://example.com/api/data', {
        headers: { 'x-compound-admin-token': 'secret' },
      });
      assert.equal(isAuthorizedRequest(req), true);
      assert.equal(requireAdmin(req), null);
    },
  );
});

test('accepts basic auth password as admin token', { concurrency: false }, async () => {
  await withEnv(
    {
      COMPOUND_ADMIN_TOKEN: 'secret',
      ADMIN_TOKEN: undefined,
      NODE_ENV: 'production',
    },
    () => {
      const auth = `Basic ${Buffer.from('user:secret').toString('base64')}`;
      const req = new Request('http://example.com/api/data', {
        headers: { authorization: auth },
      });
      assert.equal(isAuthorizedRequest(req), true);
    },
  );
});

test('returns 503 in production when admin token is missing', { concurrency: false }, async () => {
  await withEnv(
    {
      COMPOUND_ADMIN_TOKEN: undefined,
      ADMIN_TOKEN: undefined,
      NODE_ENV: 'production',
    },
    () => {
      const req = new Request('http://example.com/api/data');
      const res = requireAdmin(req);
      assert.equal(res?.status, 503);
    },
  );
});

test(
  'returns 401 when token is configured but request is unauthorized',
  { concurrency: false },
  async () => {
    await withEnv(
      {
        COMPOUND_ADMIN_TOKEN: 'secret',
        ADMIN_TOKEN: undefined,
        NODE_ENV: 'production',
      },
      () => {
        const req = new Request('http://example.com/api/data');
        const res = requireAdmin(req);
        assert.equal(res?.status, 401);
      },
    );
  },
);
