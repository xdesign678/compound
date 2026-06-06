import { PUBLIC_ERROR_MESSAGE } from '../api-error';

export function publicQueryErrorMessage(err: unknown): string {
  // Always return the generic public message — never leak internal error details.
  // The real error is logged server-side by apiError() or the caller.
  void err;
  return PUBLIC_ERROR_MESSAGE;
}

export function classifyQueryError(err: unknown): string {
  const text = `${err instanceof Error ? err.name : ''}|${
    err instanceof Error ? err.message : String(err)
  }`.toLowerCase();
  if (text.includes('timeout') || text.includes('aborted')) return 'timeout';
  if (text.includes('json') || text.includes('schema') || text.includes('unexpected')) {
    return 'parse';
  }
  if (text.includes('gateway') || text.includes('llm')) return 'gateway';
  return 'unknown';
}
