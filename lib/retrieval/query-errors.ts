export function publicQueryErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-...[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]')
    .slice(0, 300);
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
