import { NextResponse } from 'next/server';
import type { LlmConfig } from './types';

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;

  constructor(maxBytes: number) {
    super(`Request body is too large. Max ${maxBytes} bytes.`);
    this.name = 'RequestBodyTooLargeError';
  }
}

export function isRequestBodyTooLargeError(error: unknown): error is RequestBodyTooLargeError {
  return error instanceof RequestBodyTooLargeError;
}

export function enforceContentLength(req: Request, maxBytes: number): NextResponse | null {
  const raw = req.headers.get('content-length');
  if (!raw) return null;

  const size = Number(raw);
  if (!Number.isFinite(size) || size <= maxBytes) return null;

  return NextResponse.json(
    { error: `Request body is too large. Max ${maxBytes} bytes.` },
    { status: 413 },
  );
}

function assertContentLength(req: Request, maxBytes: number): void {
  const raw = req.headers.get('content-length');
  if (!raw) return;
  const size = Number(raw);
  if (Number.isFinite(size) && size > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
}

export async function readTextWithLimit(req: Request, maxBytes: number): Promise<string> {
  assertContentLength(req, maxBytes);

  if (!req.body) return '';

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }

  return chunks.join('');
}

export async function readJsonWithLimit<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const text = await readTextWithLimit(req, maxBytes);
  return JSON.parse(text || '{}') as T;
}

function clean(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

export function readLlmConfigOverride(
  req: Request,
  body?: { llmConfig?: LlmConfig },
): LlmConfig | undefined {
  const fromHeaders: LlmConfig = {
    apiKey: clean(req.headers.get('x-user-api-key')),
    apiUrl: clean(req.headers.get('x-user-api-url')),
    model: clean(req.headers.get('x-user-model')),
  };

  if (fromHeaders.apiKey || fromHeaders.apiUrl || fromHeaders.model) {
    return fromHeaders;
  }

  const fromBody = body?.llmConfig;
  if (!fromBody) return undefined;

  return {
    apiKey: clean(fromBody.apiKey),
    apiUrl: clean(fromBody.apiUrl),
    model: clean(fromBody.model),
  };
}
