import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeCrashReason,
  handleProcessCrash,
  registerGlobalCrashGuards,
} from './process-crash-guards';
import { setLoggerSink } from './server-logger';

function captureErrorLogs(fn: () => void): string[] {
  const lines: string[] = [];
  setLoggerSink({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message) => lines.push(message),
  });
  try {
    fn();
  } finally {
    setLoggerSink(null);
  }
  return lines;
}

test('describeCrashReason normalizes Error, string, and object reasons without stacks', () => {
  const fromError = describeCrashReason(new TypeError('boom at /root/secret/path'));
  assert.equal(fromError.name, 'TypeError');
  assert.equal(fromError.message, 'boom at /root/secret/path');

  const fromString = describeCrashReason('plain failure');
  assert.deepEqual(fromString, { name: 'NonError', message: 'plain failure' });

  const fromObject = describeCrashReason({ code: 'SQLITE_BUSY' });
  assert.equal(fromObject.name, 'NonError');
  assert.equal(fromObject.message, '{"code":"SQLITE_BUSY"}');
});

test('handleProcessCrash logs unhandledRejection without exiting the process', () => {
  const originalExit = process.exit;
  let exitCalls = 0;
  // @ts-expect-error test stub
  process.exit = () => {
    exitCalls += 1;
  };

  let result;
  const lines = captureErrorLogs(() => {
    result = handleProcessCrash('unhandledRejection', new Error('rejected tick'));
  });

  process.exit = originalExit;

  assert.equal(exitCalls, 0, 'unhandledRejection must never exit the process');
  assert.deepEqual(result, { kind: 'unhandledRejection', name: 'Error', message: 'rejected tick' });
  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(payload.msg, 'process.unhandled_rejection');
  assert.equal(payload.level, 'error');
  assert.equal(payload.kind, 'unhandledRejection');
  assert.equal(payload.message, 'rejected tick');
  assert.equal('stack' in payload, false);
});

test('handleProcessCrash logs uncaughtException without exiting the process', () => {
  const originalExit = process.exit;
  let exitCalls = 0;
  // @ts-expect-error test stub
  process.exit = () => {
    exitCalls += 1;
  };

  const lines = captureErrorLogs(() => {
    handleProcessCrash('uncaughtException', new RangeError('sync sqlite failure'));
  });

  process.exit = originalExit;

  assert.equal(exitCalls, 0, 'uncaughtException handler must not call process.exit by default');
  const payload = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(payload.msg, 'process.uncaught_exception');
  assert.equal(payload.name, 'RangeError');
});

test('registerGlobalCrashGuards is idempotent and wires both listeners once', () => {
  const before = {
    unhandled: process.listenerCount('unhandledRejection'),
    uncaught: process.listenerCount('uncaughtException'),
  };

  registerGlobalCrashGuards();
  const afterFirst = {
    unhandled: process.listenerCount('unhandledRejection'),
    uncaught: process.listenerCount('uncaughtException'),
  };
  registerGlobalCrashGuards();
  const afterSecond = {
    unhandled: process.listenerCount('unhandledRejection'),
    uncaught: process.listenerCount('uncaughtException'),
  };

  assert.equal(afterFirst.unhandled, before.unhandled + 1);
  assert.equal(afterFirst.uncaught, before.uncaught + 1);
  assert.deepEqual(afterSecond, afterFirst, 'second registration must not add more listeners');
});
