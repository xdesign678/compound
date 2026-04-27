import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestContext, runWithRequestContext } from './request-context';
import { logger, setLoggerSink } from './logging';

test('logging module exposes the standard structured server logger', async () => {
  const lines: Array<Record<string, unknown>> = [];
  setLoggerSink({
    debug: (m) => lines.push(JSON.parse(m)),
    info: (m) => lines.push(JSON.parse(m)),
    warn: (m) => lines.push(JSON.parse(m)),
    error: (m) => lines.push(JSON.parse(m)),
  });

  const ctx = createRequestContext({
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    requestId: 'req-logging-entrypoint',
  });

  await runWithRequestContext(ctx, async () => {
    logger.info('readiness.structured_logging', { signal: 'Structured Logging' });
  });

  setLoggerSink(null);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].msg, 'readiness.structured_logging');
  assert.equal(lines[0].requestId, 'req-logging-entrypoint');
  assert.equal(lines[0].traceId, ctx.traceId);
  assert.equal(lines[0].signal, 'Structured Logging');
});
