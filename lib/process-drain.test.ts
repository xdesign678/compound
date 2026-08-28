import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkpointAndCloseServerDb,
  collectActiveWorkerPromises,
  drainProcess,
  registerProcessDrainHandlers,
  resetProcessDrainForTests,
  waitForWorkerPromises,
} from './process-drain';
import {
  isProcessDraining,
  isProcessReady,
  markProcessUnready,
  resetProcessReadinessForTests,
} from './process-readiness';
import { setLoggerSink } from './server-logger';
import { handleUncaughtExceptionAndStop } from './process-crash-guards';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-drain-'));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  closeServerDbGlobal();
  return {
    cleanup() {
      closeServerDbGlobal();
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function captureLogs(fn: () => Promise<unknown> | void): Promise<string[]> {
  const lines: string[] = [];
  setLoggerSink({
    debug: () => {},
    info: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  });
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      setLoggerSink(null);
    })
    .then(() => lines);
}

test('isProcessDraining is true only after markProcessUnready(drain)', () => {
  resetProcessReadinessForTests();
  assert.equal(isProcessDraining(), false);
  markProcessUnready('uncaughtException');
  assert.equal(isProcessDraining(), false);
  resetProcessReadinessForTests();
  markProcessUnready('drain');
  assert.equal(isProcessDraining(), true);
  assert.equal(isProcessReady(), false);
  resetProcessReadinessForTests();
});

test('drainProcess marks unready first, aborts work, checkpoints, then mirrors SIGTERM', async () => {
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
  const events: string[] = [];
  const kills: NodeJS.Signals[] = [];
  let abortCalls = 0;
  let closeCalls = 0;

  const lines = await captureLogs(() =>
    drainProcess('SIGTERM', {
      now: () => 1000,
      delay: () => new Promise(() => {}),
      timeoutMs: 10_000,
      getWorkerPromises: () => [
        Promise.resolve().then(() => {
          events.push('worker');
        }),
      ],
      abortInFlight: () => {
        abortCalls += 1;
        events.push('abort');
      },
      closeDatabase: () => {
        closeCalls += 1;
        events.push('close');
      },
      killProcess: (signal) => {
        kills.push(signal);
        events.push('kill');
      },
      exitProcess: () => {
        events.push('exit');
      },
    }),
  );

  assert.equal(isProcessDraining(), true);
  assert.equal(isProcessReady(), false);
  assert.equal(abortCalls, 1);
  assert.equal(closeCalls, 1);
  assert.deepEqual(kills, ['SIGTERM']);
  assert.ok(!events.includes('exit'), 'must not process.exit when killProcess is injected');
  assert.deepEqual(
    events.slice(0, 2),
    ['abort', 'worker'],
    'abort in-flight before waiting for workers',
  );
  assert.ok(events.includes('close'));
  assert.ok(JSON.parse(lines[0]).msg === 'process.drain_started');
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
});

test('drain timeout emits structured log then still closes the database', async () => {
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
  let closed = false;
  const hung = new Promise(() => {});
  const lines = await captureLogs(() =>
    drainProcess('SIGINT', {
      now: (() => {
        let t = 0;
        return () => {
          t += 25;
          return t;
        };
      })(),
      delay: async () => {},
      timeoutMs: 1,
      getWorkerPromises: () => [hung],
      abortInFlight: () => {},
      closeDatabase: () => {
        closed = true;
      },
      killProcess: () => {},
      exitProcess: () => {},
    }),
  );
  assert.equal(closed, true);
  const timeoutLine = lines
    .map((line) => JSON.parse(line) as { msg?: string; remainingWorkers?: number })
    .find((row) => row.msg === 'process.drain_timeout');
  assert.ok(timeoutLine, 'process.drain_timeout must be logged');
  assert.equal(timeoutLine.remainingWorkers, 1);
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
});

test('waitForWorkerPromises times out without rejecting', async () => {
  const result = await waitForWorkerPromises([new Promise(() => {})], 1, async () => {});
  assert.equal(result.timedOut, true);
  assert.equal(result.remaining, 1);
  const ok = await waitForWorkerPromises([Promise.resolve()], 1_000, () => new Promise(() => {}));
  assert.equal(ok.timedOut, false);
  assert.equal(ok.remaining, 0);
});

test('waitForWorkerPromises remaining is unsettled count after timeout', async () => {
  const hung = new Promise(() => {});
  const result = await waitForWorkerPromises(
    [Promise.resolve(), hung, hung],
    20,
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.remaining, 1);
});

test('drain waits default worker collections before closing DB', async () => {
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
  let resolveWorker!: () => void;
  const pending = new Promise<void>((resolve) => {
    resolveWorker = resolve;
  });
  const g = globalThis as unknown as {
    __activeSyncPromises?: Set<Promise<unknown>>;
    __compoundCategoryWikiWorkers?: Map<string, Promise<unknown>>;
    __compoundSelectionWikiWorkers?: Map<string, Promise<unknown>>;
    __compoundLintWorkers?: Map<string, Promise<unknown>>;
  };
  g.__activeSyncPromises = new Set([pending]);
  g.__compoundCategoryWikiWorkers = new Map([['cw', pending]]);
  g.__compoundSelectionWikiWorkers = new Map([['sw', pending]]);
  g.__compoundLintWorkers = new Map([['lint', pending]]);
  assert.equal(collectActiveWorkerPromises().length, 1);

  let closedAfterSettle = false;
  let settled = false;
  const drain = drainProcess('SIGTERM', {
    delay: () => new Promise(() => {}),
    timeoutMs: 10_000,
    abortInFlight: () => {},
    closeDatabase: () => {
      closedAfterSettle = settled;
    },
    killProcess: () => {},
    exitProcess: () => {},
  });
  await Promise.resolve();
  settled = true;
  resolveWorker();
  await drain;
  assert.equal(closedAfterSettle, true);
  delete g.__activeSyncPromises;
  delete g.__compoundCategoryWikiWorkers;
  delete g.__compoundSelectionWikiWorkers;
  delete g.__compoundLintWorkers;
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
});

test('draining stops new analysis claims and worker loops', async (t) => {
  const env = setupTempDb();
  t.after(() => {
    env.cleanup();
    resetProcessReadinessForTests();
  });

  const { repo } = await import('./server-db');
  const { queueAdvancedAnalysisJob, runAnalysisWorkerOnce, startAnalysisWorker } =
    await import('./analysis-worker');
  repo.insertSource({
    id: 's-drain',
    title: 'Drain',
    type: 'file',
    rawContent: '# Drain',
    ingestedAt: Date.now(),
  });
  queueAdvancedAnalysisJob({ sourceId: 's-drain', stage: 'qa_index' });

  markProcessUnready('drain');
  const once = await runAnalysisWorkerOnce();
  assert.equal(once.claimed, 0);
  const started = startAnalysisWorker('drain-test');
  assert.equal(started.started, false);
  assert.equal(started.reason, 'draining');
});

test('registerProcessDrainHandlers forwards SIGTERM once with injected handles', async () => {
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
  const emitter = new EventEmitter();
  const kills: NodeJS.Signals[] = [];
  const dispose = registerProcessDrainHandlers(
    {
      delay: async () => {},
      timeoutMs: 1,
      getWorkerPromises: () => [],
      abortInFlight: () => {},
      closeDatabase: () => {},
      killProcess: (signal) => {
        kills.push(signal);
      },
      exitProcess: () => {
        throw new Error('must not call exitProcess');
      },
    },
    emitter,
  );

  emitter.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 20));
  emitter.emit('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(kills, ['SIGTERM']);
  assert.equal(isProcessDraining(), true);
  dispose();
  resetProcessReadinessForTests();
  resetProcessDrainForTests();
});

test('uncaughtException still fast-exits without waiting for drain workers', () => {
  resetProcessReadinessForTests();
  const previousExitCode = process.exitCode;
  let exitCode: number | null = null;
  handleUncaughtExceptionAndStop(new Error('boom'), (code) => {
    exitCode = code;
  });
  assert.equal(exitCode, 1);
  assert.equal(isProcessReady(), false);
  assert.equal(isProcessDraining(), false);
  resetProcessReadinessForTests();
  process.exitCode = previousExitCode;
});

test('checkpointAndCloseServerDb is a no-op without an open holder', () => {
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
  checkpointAndCloseServerDb();
});
