/**
 * Process-level crash guards.
 *
 * Registers global `unhandledRejection` / `uncaughtException` handlers so
 * background failures are observed and classified instead of disappearing.
 * Both handlers emit a structured log line and forward the error to Sentry
 * when configured.
 *
 * Policy: unhandledRejection is logged and the process stays up. uncaughtException
 * marks readiness failed, logs, then exits non-zero so the supervisor can
 * replace a potentially corrupted process. This is Node-runtime only.
 *
 * Server-only.
 */
import { markProcessUnready } from './process-readiness';
import { logger } from './server-logger';
import { reportError } from './observability/sentry';

export type ProcessCrashKind = 'unhandledRejection' | 'uncaughtException';

export interface ProcessCrashLog {
  kind: ProcessCrashKind;
  name: string;
  message: string;
}

/**
 * Reduce an arbitrary thrown/rejected value to a stable `{ name, message }`
 * pair. Never includes a stack trace so log lines stay free of absolute paths
 * and other internals.
 */
export function describeCrashReason(reason: unknown): { name: string; message: string } {
  if (reason instanceof Error) {
    return { name: reason.name || 'Error', message: reason.message };
  }
  if (typeof reason === 'string') {
    return { name: 'NonError', message: reason };
  }
  let message: string;
  try {
    message = JSON.stringify(reason);
  } catch {
    message = String(reason);
  }
  return { name: 'NonError', message };
}

/** Next/Node may surface an already-disconnected HTTP request as an uncaught abort. */
export function isExpectedTransportAbort(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  const code = (reason as Error & { code?: unknown }).code;
  return reason.name === 'Error' && reason.message === 'aborted' && code === 'ECONNRESET';
}

/**
 * Handle a process-level crash event: structured log + (optional) Sentry. Pure
 * with respect to control flow — it deliberately never exits the process and
 * returns the fields it logged so callers/tests can assert on them.
 */
export function handleProcessCrash(kind: ProcessCrashKind, reason: unknown): ProcessCrashLog {
  const { name, message } = describeCrashReason(reason);
  if (kind === 'uncaughtException') {
    markProcessUnready('uncaughtException');
  }
  logger.error(
    kind === 'unhandledRejection' ? 'process.unhandled_rejection' : 'process.uncaught_exception',
    { kind, name, message },
  );
  reportError(reason instanceof Error ? reason : new Error(`${name}: ${message}`), {
    tags: { area: 'process', kind },
    level: kind === 'uncaughtException' ? 'fatal' : 'error',
  });
  return { kind, name, message };
}

let registered = false;

/**
 * Idempotently register the global crash guards. Safe to call more than once
 * per process (e.g. across HMR reloads); only the first call wires listeners.
 */
export function registerGlobalCrashGuards(): void {
  if (registered) return;
  registered = true;

  process.on('unhandledRejection', (reason) => {
    handleProcessCrash('unhandledRejection', reason);
    // Never exit: a single rejected promise must not take the server down.
  });

  process.on('uncaughtException', (err) => {
    handleUncaughtExceptionAndStop(err);
  });
}

export function handleUncaughtExceptionAndStop(
  err: unknown,
  exitProcess: (code: number) => never | void = (code) => {
    process.exit(code);
  },
): void {
  if (isExpectedTransportAbort(err)) {
    logger.warn('process.transport_abort_ignored', {
      kind: 'uncaughtException',
      name: 'Error',
      message: 'aborted',
      code: 'ECONNRESET',
    });
    return;
  }
  handleProcessCrash('uncaughtException', err);
  process.exitCode = 1;
  exitProcess(1);
}
