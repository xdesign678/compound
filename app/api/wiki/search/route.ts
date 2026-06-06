import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { clampLimit, MAX_CONCEPT_LIMIT, MAX_CHUNK_LIMIT } from '@/lib/clamp';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 512_000;
const DEFAULT_CONCEPT_LIMIT = 24;
const DEFAULT_CHUNK_LIMIT = 12;

export const POST = withRequestTracing(async (req: Request) => {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = await readJsonWithLimit<{
      query?: string;
      conceptLimit?: number;
      chunkLimit?: number;
    }>(req, MAX_BODY_BYTES);
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }
    if (query.length > 2000) {
      return NextResponse.json({ error: 'query too long (max 2000 characters)' }, { status: 400 });
    }

    // Validate and clamp numeric limits (VAL-API-013 / VAL-API-014)
    if (body.conceptLimit !== undefined && body.conceptLimit !== null) {
      const clamped = clampLimit(body.conceptLimit, MAX_CONCEPT_LIMIT);
      if (clamped === undefined) {
        return NextResponse.json(
          { error: 'conceptLimit must be a positive integer (1–100)' },
          { status: 400 },
        );
      }
      body.conceptLimit = clamped;
    }
    if (body.chunkLimit !== undefined && body.chunkLimit !== null) {
      const clamped = clampLimit(body.chunkLimit, MAX_CHUNK_LIMIT);
      if (clamped === undefined) {
        return NextResponse.json(
          { error: 'chunkLimit must be a positive integer (1–50)' },
          { status: 400 },
        );
      }
      body.chunkLimit = clamped;
    }

    const context = wikiRepo.searchWikiContext(query, {
      conceptLimit: body.conceptLimit ?? DEFAULT_CONCEPT_LIMIT,
      chunkLimit: body.chunkLimit ?? DEFAULT_CHUNK_LIMIT,
    });

    return NextResponse.json(context);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      apiError(error, getRequestContext()?.requestId, 'wiki.search_failed'),
      { status: 500 },
    );
  }
});
