import { NextResponse } from 'next/server';
import { runIngestLLM } from '@/lib/ingest-core';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import { enforceContentLength, readLlmConfigOverride } from '@/lib/request-guards';
import type { IngestRequest } from '@/lib/types';

export const runtime = 'nodejs';
// LLM gateway uses a 55s signal timeout; give the route ~35s of headroom for
// retries, JSON parse, DB writes, and network latency.
export const maxDuration = 90;

const MAX_BODY_BYTES = 512_000;
const MAX_RAW_CONTENT_CHARS = 100_000;
const MAX_EXISTING_CONCEPTS = 500;

export async function POST(req: Request) {
  const denied = requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as IngestRequest;
    if (!body?.source) {
      return NextResponse.json({ error: 'source is required' }, { status: 400 });
    }
    if (!body.source.rawContent) {
      return NextResponse.json({ error: 'source.rawContent is required' }, { status: 400 });
    }
    if (body.source.rawContent.length > MAX_RAW_CONTENT_CHARS) {
      return NextResponse.json(
        { error: `source.rawContent is too long. Max ${MAX_RAW_CONTENT_CHARS} characters.` },
        { status: 413 }
      );
    }
    if (!Array.isArray(body.existingConcepts)) {
      return NextResponse.json({ error: 'existingConcepts must be an array' }, { status: 400 });
    }
    if (body.existingConcepts.length > MAX_EXISTING_CONCEPTS) {
      return NextResponse.json({ error: 'Too many existing concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);

    // Extract existing categories with runtime validation
    const existingCategories = Array.isArray(body.existingCategories)
      ? body.existingCategories.filter((c): c is string => typeof c === 'string').slice(0, 100)
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
