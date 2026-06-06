/**
 * Process-level crash guards.
 *
 * Registers global `unhandledRejection` / `uncaughtException` handlers so a
 * single failing background tick (e.g. a synchronous better-sqlite3
 * `SQLITE_BUSY` / disk error inside a worker loop) can never take down the
 * whole Node.js process. Both handlers emit a structured log line and forward
 * the error to Sentry when configured.
 *
 * Policy: neither handler calls `process.exit()`. An unhandled rejection must
 * never terminate the server, and an uncaught exception is logged but the
 * service stays available (the host's liveness probe can still restart us if
 * the process is genuinely wedged). This is intentionally Node-runtime only —
 * the Edge runtime has no `process` event emitter and never reaches here.
 *
 * Server-only.
 */
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

/**
 * Handle a process-level crash event: structured log + (optional) Sentry. Pure
 * with respect to control flow — it deliberately never exits the process and
 * returns the fields it logged so callers/tests can assert on them.
 */
export function handleProcessCrash(kind: ProcessCrashKind, reason: unknown): ProcessCrashLog {
  const { name, message } = describeCrashReason(reason);
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
    handleProcessCrash('uncaughtException', err);
    // Stay up by default — logging is enough to keep the service available for
    // other requests; we do not call process.exit() here.
  });
}
