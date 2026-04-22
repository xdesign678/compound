import { NextResponse } from 'next/server';
import type { LlmConfig } from './types';

export function enforceContentLength(req: Request, maxBytes: number): NextResponse | null {
  const raw = req.headers.get('content-length');
  if (!raw) return null;

  const size = Number(raw);
  if (!Number.isFinite(size) || size <= maxBytes) return null;

  return NextResponse.json(
    { error: `Request body is too large. Max ${maxBytes} bytes.` },
    { status: 413 }
  );
}

function clean(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

export function readLlmConfigOverride(
  req: Request,
  body?: { llmConfig?: LlmConfig }
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
