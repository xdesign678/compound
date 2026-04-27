import test from 'node:test';
import assert from 'node:assert/strict';

import { logger, setLoggerSink } from './logging';
import { createRequestContext, runWithRequestContext } from './request-context';

interface Captured {
  level: string;
  payload: Record<string, unknown>;
}

function captureLogs(fn: () => void | Promise<void>): Promise<Captured[]> {
  const lines: Captured[] = [];
  setLoggerSink({
    debug: (m) => lines.push({ level: 'debug', payload: JSON.parse(m) }),
    info: (m) => lines.push({ level: 'info', payload: JSON.parse(m) }),
    warn: (m) => lines.push({ level: 'warn', payload: JSON.parse(m) }),
    error: (m) => lines.push({ level: 'error', payload: JSON.parse(m) }),
  });
  return Promise.resolve(fn()).then(() => {
    setLoggerSink(null);
    return lines;
  });
}

test('logger emits structured NDJSON without an active context', async () => {
  const lines = await captureLogs(() => {
    logger.info('hello.world', { foo: 'bar' });
  });

  assert.equal(lines.length, 1);
  const { level, payload } = lines[0];
  assert.equal(level, 'info');
  assert.equal(payload.msg, 'hello.world');
  assert.equal(payload.level, 'info');
  assert.equal(payload.foo, 'bar');
  assert.equal('requestId' in payload, false);
  assert.match(String(payload.ts), /T.*Z$/);
});

test('logger attaches request context fields when one is active', async () => {
  const ctx = createRequestContext({
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    requestId: 'req-test-1',
  });

  const lines = await captureLogs(async () => {
    await runWithRequestContext(ctx, async () => {
      logger.warn('sync.slow', { durationMs: 1234 });
    });
  });

  assert.equal(lines.length, 1);
  const { payload } = lines[0];
  assert.equal(payload.requestId, 'req-test-1');
  assert.equal(payload.traceId, ctx.traceId);
  assert.equal(payload.spanId, ctx.spanId);
  assert.equal(payload.parentSpanId, 'b7ad6b7169203331');
  assert.equal(payload.durationMs, 1234);
});

test('logger serialises Error instances safely', async () => {
  const err = new Error('boom');
  const lines = await captureLogs(() => {
    logger.error('explosion', { cause: err });
  });
  const cause = lines[0].payload.cause as { name: string; message: string };
  assert.equal(cause.name, 'Error');
  assert.equal(cause.message, 'boom');
});
