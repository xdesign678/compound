/**
 * Tiny structured logger that automatically attaches the active
 * {@link RequestContext} so that every log line can be correlated back to a
 * specific request, trace and span.
 *
 * The output is intentionally newline-delimited JSON: it is greppable in plain
 * `console` output, and can be ingested by any log pipeline that understands
 * NDJSON.
 *
 * Example:
 *   logger.info('sync.completed', { runId, files: 12 });
 *   // {"ts":"2026-...","level":"info","msg":"sync.completed",
 *   //  "requestId":"...","traceId":"...","spanId":"...","runId":"...","files":12}
 *
 * Server-only.
 */
import { getRequestContext } from './request-context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

interface ConsoleSink {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const defaultSink: ConsoleSink = {
  debug: (m) => console.debug(m),
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

let sink: ConsoleSink = defaultSink;

/** Override the underlying console for tests. */
export function setLoggerSink(custom: ConsoleSink | null): void {
  sink = custom ?? defaultSink;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserialisable: String(value) });
  }
}

function format(level: LogLevel, message: string, fields?: LogFields): string {
  const ctx = getRequestContext();
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (ctx) {
    payload.requestId = ctx.requestId;
    payload.traceId = ctx.traceId;
    payload.spanId = ctx.spanId;
    if (ctx.parentSpanId) payload.parentSpanId = ctx.parentSpanId;
  }
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (key in payload) continue;
      payload[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
    }
  }
  return safeStringify(payload);
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  const line = format(level, message, fields);
  switch (level) {
    case 'debug':
      sink.debug(line);
      return;
    case 'info':
      sink.info(line);
      return;
    case 'warn':
      sink.warn(line);
      return;
    case 'error':
      sink.error(line);
      return;
  }
}

export const logger = {
  debug(message: string, fields?: LogFields): void {
    emit('debug', message, fields);
  },
  info(message: string, fields?: LogFields): void {
    emit('info', message, fields);
  },
  warn(message: string, fields?: LogFields): void {
    emit('warn', message, fields);
  },
  error(message: string, fields?: LogFields): void {
    emit('error', message, fields);
  },
};

/** Convenience helper for the common "logged + raised" error pattern. */
export function logAndWrapError(message: string, err: unknown, fields?: LogFields): Error {
  const detail = err instanceof Error ? err.message : String(err);
  logger.error(message, { ...(fields ?? {}), error: detail });
  return new Error(`${message}: ${detail}`);
}
