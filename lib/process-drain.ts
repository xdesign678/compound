/**
 * Graceful process drain for SIGTERM/SIGINT.
 *
 * Order: mark unready('drain') → stop new worker claims → abort in-flight
 * LLM/fetch → wait a bounded time for worker promises → on timeout emit a
 * structured log → WAL checkpoint + close SQLite → re-raise the original
 * signal so supervisors still see signal-style exit. uncaughtException is
 * intentionally not handled here (fast-exit stays in process-crash-guards).
 *
 * Server-only.
 */
import { markProcessUnready } from './process-readiness';
import { logger } from './logging';

export const PROCESS_DRAIN_ABORT_MESSAGE = 'process draining';
export const DEFAULT_DRAIN_TIMEOUT_MS = Math.max(
  0,
  Number(process.env.COMPOUND_DRAIN_TIMEOUT_MS || 10_000),
);

const DRAIN_ABORT_KEY = '__compound_drain_abort__';
const DRAIN_REGISTERED_KEY = '__compound_drain_registered__';
const SQLITE_HOLDER_KEY = '__compound_sqlite__';

interface DrainAbortHolder {
  [DRAIN_ABORT_KEY]?: AbortController;
  [DRAIN_REGISTERED_KEY]?: boolean;
}

interface SqliteHolder {
  db?: {
    pragma?: (source: string) => unknown;
    close?: () => void;
    open?: boolean;
  };
}

export type ProcessDrainSignal = 'SIGTERM' | 'SIGINT';

export interface ProcessDrainHandles {
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  exitProcess?: (code: number) => void;
  killProcess?: (signal: NodeJS.Signals) => void;
  getWorkerPromises?: () => Array<Promise<unknown>>;
  abortInFlight?: () => void;
  closeDatabase?: () => void;
  timeoutMs?: number;
}

function drainAbortHolder(): DrainAbortHolder {
  return globalThis as unknown as DrainAbortHolder;
}

function drainAbortController(): AbortController {
  const holder = drainAbortHolder();
  holder[DRAIN_ABORT_KEY] ??= new AbortController();
  return holder[DRAIN_ABORT_KEY];
}

export function getProcessDrainSignal(): AbortSignal {
  return drainAbortController().signal;
}

export function isProcessDrainAbort(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  if (reason.message.includes(PROCESS_DRAIN_ABORT_MESSAGE)) return true;
  const cause = (reason as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message.includes(PROCESS_DRAIN_ABORT_MESSAGE)) return true;
  return reason.name === 'AbortError' && getProcessDrainSignal().aborted;
}

export function abortProcessDrainWork(reason = PROCESS_DRAIN_ABORT_MESSAGE): void {
  const ctrl = drainAbortController();
  if (ctrl.signal.aborted) return;
  try {
    ctrl.abort(new Error(reason));
  } catch {
    // already aborted
  }
}

export function collectActiveWorkerPromises(): Array<Promise<unknown>> {
  const g = globalThis as unknown as {
    __activeAnalysisWorkerPromises?: Set<Promise<unknown>>;
    __compoundRepairWorkers?: Map<string, Promise<unknown>>;
    __activeSyncPromises?: Set<Promise<unknown>>;
    __compoundCategoryWikiWorkers?: Map<string, Promise<unknown>>;
    __compoundSelectionWikiWorkers?: Map<string, Promise<unknown>>;
    __compoundLintWorkers?: Map<string, Promise<unknown>>;
  };
  const seen = new Set<Promise<unknown>>();
  const add = (items?: Iterable<Promise<unknown>>) => {
    if (!items) return;
    for (const promise of items) seen.add(promise);
  };
  add(g.__activeAnalysisWorkerPromises);
  add(g.__compoundRepairWorkers?.values());
  add(g.__activeSyncPromises);
  add(g.__compoundCategoryWikiWorkers?.values());
  add(g.__compoundSelectionWikiWorkers?.values());
  add(g.__compoundLintWorkers?.values());
  return [...seen];
}

function defaultWorkerPromises(): Array<Promise<unknown>> {
  return collectActiveWorkerPromises();
}

/** Combine a caller signal with the process drain abort signal. */
export function withProcessDrainSignal(signal?: AbortSignal): AbortSignal {
  const drain = getProcessDrainSignal();
  if (!signal || signal === drain) return drain;
  const any = (AbortSignal as typeof AbortSignal & { any?: (input: AbortSignal[]) => AbortSignal })
    .any;
  if (typeof any === 'function') return any([signal, drain]);
  const ctrl = new AbortController();
  const forward = (source: AbortSignal) => {
    if (!ctrl.signal.aborted) ctrl.abort(source.reason);
  };
  for (const source of [signal, drain]) {
    if (source.aborted) {
      forward(source);
      return ctrl.signal;
    }
    source.addEventListener('abort', () => forward(source), { once: true });
  }
  return ctrl.signal;
}

function defaultAbortInFlight(): void {
  abortProcessDrainWork();
  const g = globalThis as unknown as {
    __analysisCancelControllers?: Map<string, AbortController>;
  };
  for (const ctrl of g.__analysisCancelControllers?.values() ?? []) {
    if (ctrl.signal.aborted) continue;
    try {
      ctrl.abort(new Error(PROCESS_DRAIN_ABORT_MESSAGE));
    } catch {
      // already aborted
    }
  }
}

export function checkpointAndCloseServerDb(): void {
  const g = globalThis as unknown as Record<string, SqliteHolder | undefined>;
  const holder = g[SQLITE_HOLDER_KEY];
  const db = holder?.db;
  if (!db) return;
  try {
    db.pragma?.('wal_checkpoint(TRUNCATE)');
  } catch {
    try {
      db.pragma?.('wal_checkpoint(PASSIVE)');
    } catch {
      // Checkpoint is best-effort before close.
    }
  }
  try {
    if (db.open !== false) db.close?.();
  } catch {
    // Already closed or closing.
  }
  delete g[SQLITE_HOLDER_KEY];
}

function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGTERM') return 143;
  return 1;
}

export async function waitForWorkerPromises(
  promises: Array<Promise<unknown>>,
  timeoutMs: number,
  delay: (ms: number) => Promise<void>,
): Promise<{ timedOut: boolean; remaining: number }> {
  const unique = [...new Set(promises)];
  if (unique.length === 0) return { timedOut: false, remaining: 0 };
  const pending = new Set(unique);
  const tracked = unique.map((promise) =>
    Promise.resolve(promise).finally(() => {
      pending.delete(promise);
    }),
  );
  if (timeoutMs <= 0) {
    await Promise.resolve();
    return { timedOut: true, remaining: pending.size };
  }
  let timedOut = false;
  await Promise.race([
    Promise.allSettled(tracked),
    delay(timeoutMs).then(() => {
      timedOut = true;
    }),
  ]);
  return { timedOut, remaining: pending.size };
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as NodeJS.Timeout & { unref?: () => void }).unref?.();
  });
}

/**
 * Run the drain sequence. Never calls process.exit itself unless the injected
 * `exitProcess` / `killProcess` handles do — tests must inject those.
 */
export async function drainProcess(
  signal: ProcessDrainSignal,
  handles: ProcessDrainHandles = {},
): Promise<{ timedOut: boolean; waitedMs: number }> {
  const now = handles.now ?? Date.now;
  const startedAt = now();
  markProcessUnready('drain');
  logger.info('process.drain_started', { signal, reason: 'drain' });

  const abortInFlight = handles.abortInFlight ?? defaultAbortInFlight;
  abortInFlight();

  const timeoutMs = handles.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const promises = (handles.getWorkerPromises ?? defaultWorkerPromises)();
  const delay = handles.delay ?? defaultDelay;
  const { timedOut, remaining } = await waitForWorkerPromises(promises, timeoutMs, delay);
  const waitedMs = Math.max(0, now() - startedAt);

  if (timedOut) {
    logger.warn('process.drain_timeout', {
      signal,
      timeoutMs,
      waitedMs,
      remainingWorkers: remaining,
    });
  }

  const closeDatabase = handles.closeDatabase ?? checkpointAndCloseServerDb;
  closeDatabase();

  logger.info('process.drain_completed', { signal, timedOut, waitedMs });

  const usesInjectedTerminator = Boolean(handles.killProcess || handles.exitProcess);
  const killProcess =
    handles.killProcess ??
    ((sig: NodeJS.Signals) => {
      process.kill(process.pid, sig);
    });
  const exitProcess =
    handles.exitProcess ??
    ((code: number) => {
      process.exit(code);
    });

  if (!usesInjectedTerminator) {
    process.exitCode = signalExitCode(signal);
  }
  try {
    killProcess(signal);
  } catch {
    exitProcess(
      usesInjectedTerminator ? signalExitCode(signal) : Number(process.exitCode ?? 1) || 1,
    );
  }

  return { timedOut, waitedMs };
}

export function resetProcessDrainForTests(): void {
  const holder = drainAbortHolder();
  holder[DRAIN_ABORT_KEY] = new AbortController();
  holder[DRAIN_REGISTERED_KEY] = false;
}

/**
 * Idempotently register SIGTERM/SIGINT drain. Returns a disposer for tests.
 * A second signal while drain is in flight is ignored (one-shot).
 */
export function registerProcessDrainHandlers(
  handles: ProcessDrainHandles = {},
  emitter: NodeJS.EventEmitter = process,
): () => void {
  const holder = drainAbortHolder();
  if (holder[DRAIN_REGISTERED_KEY]) {
    return () => undefined;
  }
  holder[DRAIN_REGISTERED_KEY] = true;

  let draining = false;
  const dispose = () => {
    emitter.off('SIGTERM', onTerm);
    emitter.off('SIGINT', onInt);
    holder[DRAIN_REGISTERED_KEY] = false;
    draining = false;
  };

  const resolvedHandles: ProcessDrainHandles = {
    ...handles,
    killProcess:
      handles.killProcess ??
      ((sig: NodeJS.Signals) => {
        dispose();
        process.kill(process.pid, sig);
      }),
  };

  const onSignal = (signal: ProcessDrainSignal) => {
    if (draining) return;
    draining = true;
    void drainProcess(signal, resolvedHandles).catch((err) => {
      logger.error('process.drain_failed', {
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        (resolvedHandles.killProcess ?? ((sig: NodeJS.Signals) => process.kill(process.pid, sig)))(
          signal,
        );
      } catch {
        (resolvedHandles.exitProcess ?? ((code: number) => process.exit(code)))(
          signalExitCode(signal),
        );
      }
    });
  };

  const onTerm = () => onSignal('SIGTERM');
  const onInt = () => onSignal('SIGINT');
  emitter.on('SIGTERM', onTerm);
  emitter.on('SIGINT', onInt);

  return dispose;
}
