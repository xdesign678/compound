import { NextResponse } from 'next/server';
import { logger } from '@/lib/logging';
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

    const context = wikiRepo.searchWikiContext(query, {
      conceptLimit: body.conceptLimit ?? 24,
      chunkLimit: body.chunkLimit ?? 12,
    });

    return NextResponse.json(context);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error('wiki.search_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Wiki search failed' }, { status: 500 });
  }
});
