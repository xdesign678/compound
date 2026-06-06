import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiError, PUBLIC_ERROR_MESSAGE } from './api-error';
import { setLoggerSink } from './logging';
import type { LogFields } from './logging';

describe('apiError', () => {
  const captured: Array<{ level: string; msg: string } & LogFields> = [];

  beforeEach(() => {
    captured.length = 0;
    setLoggerSink({
      debug: (m: string) => captured.push(JSON.parse(m)),
      info: (m: string) => captured.push(JSON.parse(m)),
      warn: (m: string) => captured.push(JSON.parse(m)),
      error: (m: string) => captured.push(JSON.parse(m)),
    });
  });

  afterEach(() => {
    setLoggerSink(null);
  });

  it('returns generic public message — never the real error text', () => {
    const result = apiError(new Error('SQLITE_CONST: unique constraint /root/data/compound.db'));
    assert.equal(result.error, PUBLIC_ERROR_MESSAGE);
    assert.equal(result.error.includes('SQLITE_CONST'), false);
    assert.equal(result.error.includes('/root/'), false);
  });

  it('includes requestId when provided', () => {
    const result = apiError(new Error('boom'), 'req-abc-123');
    assert.equal(result.requestId, 'req-abc-123');
  });

  it('omits requestId when undefined', () => {
    const result = apiError(new Error('boom'));
    assert.equal(result.requestId, undefined);
  });

  it('logs the real error detail server-side', () => {
    const err = new Error('GITHUB_REPO not set: /root/compound/.env.local');
    apiError(err, 'req-1', 'sync.github.failed');

    assert.equal(captured.length, 1);
    assert.equal(captured[0].level, 'error');
    assert.equal(captured[0].msg, 'sync.github.failed');
    assert.equal(captured[0].errorMessage, err.message);
    assert.equal(captured[0].errorName, 'Error');
    assert.equal(captured[0].requestId, 'req-1');
  });

  it('uses default event name "api.unhandled_error" when none provided', () => {
    apiError(new Error('x'));
    assert.equal(captured[0].msg, 'api.unhandled_error');
  });

  it('handles non-Error throws gracefully', () => {
    const result = apiError('string error', 'req-2');
    assert.equal(result.error, PUBLIC_ERROR_MESSAGE);
    assert.equal(captured[0].errorMessage, 'string error');
    assert.equal(captured[0].errorName, undefined);
  });

  it('handles null/undefined throws', () => {
    const result = apiError(null, 'req-3');
    assert.equal(result.error, PUBLIC_ERROR_MESSAGE);
    assert.equal(captured[0].errorMessage, 'null');
  });

  it('never includes file paths, SQLITE, or internal strings in public message', () => {
    const dangerous = new Error(
      'ENOENT: no such file /root/compound/data/compound.db at Object.<anonymous> (node:internal/modules/cjs/loader:123:45)',
    );
    const result = apiError(dangerous, 'req-4');
    assert.equal(result.error, PUBLIC_ERROR_MESSAGE);

    // Explicitly verify none of the leak markers appear
    const body = JSON.stringify(result);
    const forbidden = ['/root/', 'SQLITE', 'better-sqlite3', 'at Object', 'node:'];
    for (const marker of forbidden) {
      assert.equal(body.includes(marker), false, `Leaked "${marker}" in response body`);
    }
  });
});
