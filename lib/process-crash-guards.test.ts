import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeCrashReason,
  handleProcessCrash,
  handleUncaughtExceptionAndStop,
  isExpectedTransportAbort,
  registerGlobalCrashGuards,
} from './process-crash-guards';
import { isProcessReady, resetProcessReadinessForTests } from './process-readiness';
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

test('handleProcessCrash marks readiness failed on uncaughtException without exiting itself', () => {
  resetProcessReadinessForTests();
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

  assert.equal(exitCalls, 0, 'handleProcessCrash must not exit; the listener does');
  assert.equal(isProcessReady(), false);
  const payload = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(payload.msg, 'process.uncaught_exception');
  assert.equal(payload.name, 'RangeError');
});

test('uncaughtException listener control flow marks unready and requests exit without killing tests', () => {
  resetProcessReadinessForTests();
  const previousExitCode = process.exitCode;
  let exitCode: number | null = null;
  handleUncaughtExceptionAndStop(new Error('listener boom'), (code: number) => {
    exitCode = code;
  });
  assert.equal(exitCode, 1);
  assert.equal(process.exitCode, 1);
  assert.equal(isProcessReady(), false);
  resetProcessReadinessForTests();
  process.exitCode = previousExitCode;
});

test('an exact HTTP transport abort does not make the process unready or exit', () => {
  resetProcessReadinessForTests();
  const previousExitCode = process.exitCode;
  let exitCalls = 0;
  const abort = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });

  assert.equal(isExpectedTransportAbort(abort), true);
  assert.equal(
    isExpectedTransportAbort(Object.assign(new Error('boom'), { code: 'ECONNRESET' })),
    false,
  );
  assert.equal(
    isExpectedTransportAbort(Object.assign(new Error('aborted'), { code: 'EPIPE' })),
    false,
  );

  handleUncaughtExceptionAndStop(abort, () => {
    exitCalls += 1;
  });
  assert.equal(exitCalls, 0);
  assert.equal(isProcessReady(), true);
  assert.equal(process.exitCode, previousExitCode);
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
