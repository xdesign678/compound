import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin } from '@/lib/server-auth';
import {
  getCategoryWiki,
  createCategoryWikiRun,
  startCategoryWikiWorker,
  getCategoryWikiRunStart,
} from '@/lib/category-wiki-worker';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import type { CategoryWikiRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BODY_BYTES = 256_000;

/**
 * GET /api/wiki/category?primary=X&secondary=Y
 * Returns cached category wiki if available.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const primary = url.searchParams.get('primary')?.trim();
  const secondary = url.searchParams.get('secondary')?.trim();

  if (!primary || !secondary) {
    return NextResponse.json(
      { error: 'primary and secondary query params are required' },
      { status: 400 },
    );
  }

  try {
    const wiki = getCategoryWiki(primary, secondary);
    return NextResponse.json(wiki);
  } catch (error) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(error, requestId, 'wiki.category_get_failed'), {
      status: 500,
    });
  }
}

/**
 * POST /api/wiki/category
 * Creates a category wiki generation run and returns the run info.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = await readJsonWithLimit<CategoryWikiRequest>(req, MAX_BODY_BYTES);
    const primary = body.primary?.trim();
    const secondary = body.secondary?.trim();

    if (!primary || !secondary) {
      return NextResponse.json({ error: 'primary and secondary are required' }, { status: 400 });
    }

    const request: CategoryWikiRequest = { primary, secondary, llmConfig: body.llmConfig };
    const runId = createCategoryWikiRun(request);
    startCategoryWikiWorker(runId, body.llmConfig);

    const start = getCategoryWikiRunStart(runId);
    return NextResponse.json(start, { status: 202 });
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(error, requestId, 'wiki.category_post_failed'), {
      status: 500,
    });
  }
}
