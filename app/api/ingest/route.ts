import { NextResponse } from 'next/server';
import { runIngestLLM } from '@/lib/ingest-core';
import type { IngestRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IngestRequest;
    if (!body?.source) {
      return NextResponse.json({ error: 'source is required' }, { status: 400 });
    }
    if (!body.source.rawContent) {
      return NextResponse.json({ error: 'source.rawContent is required' }, { status: 400 });
    }
    if (!Array.isArray(body.existingConcepts)) {
      return NextResponse.json({ error: 'existingConcepts must be an array' }, { status: 400 });
    }

    // Read LLM config from request headers (preferred) or fall back to body
    const apiKey = req.headers.get('x-user-api-key') || undefined;
    const apiUrl = req.headers.get('x-user-api-url') || undefined;
    const model = req.headers.get('x-user-model') || undefined;
    const llmConfig = apiKey || apiUrl || model ? { apiKey, apiUrl, model } : body.llmConfig;

    // Extract existing categories with runtime validation
    const existingCategories = Array.isArray(body.existingCategories)
      ? body.existingCategories.filter((c): c is string => typeof c === 'string')
      : [];

    const parsed = await runIngestLLM({
      source: body.source,
      existingConcepts: body.existingConcepts,
      existingCategories,
      llmConfig,
    });

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[ingest] error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: 'Ingest processing failed. Please check your API configuration.' },
      { status: 500 }
    );
  }
}
