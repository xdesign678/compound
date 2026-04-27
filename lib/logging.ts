/**
 * Standard structured logging entrypoint for server-side code.
 *
 * Import from this module in API routes, workers and persistence helpers so
 * operational logs share the same NDJSON shape and request correlation fields.
 */
export { logger, logAndWrapError, setLoggerSink } from './server-logger';
export type { LogFields, LogLevel } from './server-logger';
