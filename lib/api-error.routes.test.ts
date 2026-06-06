/**
 * Integration-style tests for the unified error response shape.
 *
 * Verifies that `requireAdmin` 401 responses and route error catch-blocks
 * produce the canonical { error, requestId } shape with no internal leakage.
 * Uses the same temporary-DB setup pattern as other server-side tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from './server-auth';
import { apiError, PUBLIC_ERROR_MESSAGE } from './api-error';

describe('requireAdmin 401 response', () => {
  it('includes requestId and generic "Unauthorized" message', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: { 'x-request-id': 'req-test-401' },
    });

    // Set env so admin auth is enforced
    const prev = process.env.COMPOUND_ADMIN_TOKEN;
    process.env.COMPOUND_ADMIN_TOKEN = 'test-admin-token';

    const denied = requireAdmin(req);

    // Restore
    if (prev) process.env.COMPOUND_ADMIN_TOKEN = prev;
    else delete process.env.COMPOUND_ADMIN_TOKEN;

    assert.ok(denied, 'expected a 401 response');
    assert.equal(denied!.status, 401);
    const body = (await denied!.json()) as { error: string; requestId?: string };
    assert.equal(body.error, 'Unauthorized');
    assert.equal(body.requestId, 'req-test-401');
  });

  it('omits requestId when no x-request-id header', async () => {
    const req = new Request('http://localhost/api/test');
    const prev = process.env.COMPOUND_ADMIN_TOKEN;
    process.env.COMPOUND_ADMIN_TOKEN = 'test-admin-token';

    const denied = requireAdmin(req);

    if (prev) process.env.COMPOUND_ADMIN_TOKEN = prev;
    else delete process.env.COMPOUND_ADMIN_TOKEN;

    assert.ok(denied);
    assert.equal(denied!.status, 401);
    const body = (await denied!.json()) as { error: string; requestId?: string };
    assert.equal(body.error, 'Unauthorized');
    assert.equal(body.requestId, undefined);
  });

  it('never leaks internal details in 401 body', async () => {
    const req = new Request('http://localhost/api/test', {
      headers: {
        authorization: 'Bearer wrong-token',
        'x-request-id': 'req-401-leak',
      },
    });
    const prev = process.env.COMPOUND_ADMIN_TOKEN;
    process.env.COMPOUND_ADMIN_TOKEN = 'test-admin-token';

    const denied = requireAdmin(req);

    if (prev) process.env.COMPOUND_ADMIN_TOKEN = prev;
    else delete process.env.COMPOUND_ADMIN_TOKEN;

    assert.ok(denied);
    const body = JSON.stringify(await denied!.json());
    const forbidden = ['/root/', 'SQLITE', 'better-sqlite3', 'at Object', 'node:'];
    for (const marker of forbidden) {
      assert.doesNotMatch(body, new RegExp(marker), `Leaked "${marker}" in 401 body`);
    }
  });
});

describe('apiError response shape', () => {
  it('always uses PUBLIC_ERROR_MESSAGE regardless of error content', () => {
    const result = apiError(
      new Error('ENOENT: /root/compound/data/compound.db SQLITE_CONST at Object node:'),
      'req-1',
    );
    assert.equal(result.error, PUBLIC_ERROR_MESSAGE);
    assert.equal(result.requestId, 'req-1');
  });

  it('handles various error types without leaking', () => {
    const cases = [
      new Error('GITHUB_REPO not set: check /root/compound/.env.local'),
      'string error with /root/ path',
      42,
      null,
      undefined,
      { message: 'custom' },
    ];

    for (const err of cases) {
      const result = apiError(err, 'req-test');
      assert.equal(result.error, PUBLIC_ERROR_MESSAGE, `Leaked for error: ${JSON.stringify(err)}`);
      assert.equal(result.requestId, 'req-test');
    }
  });
});
