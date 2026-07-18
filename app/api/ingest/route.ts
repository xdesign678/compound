import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { ingestSourceToServerDb } from '@/lib/server-ingest';
import { requireAdmin } from '@/lib/server-auth';
import { llmRateLimit } from '@/lib/rate-limit';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
  readLlmConfigOverride,
} from '@/lib/request-guards';
import { getRequestContext, withRequestTracing } from '@/lib/request-context';
import { logger } from '@/lib/server-logger';
import type { IngestRequest } from '@/lib/types';

export const runtime = 'nodejs';
// Manual ingest is a synchronous compatibility path. Keep its request budget
// above the gateway's reasoning-model ceiling; background enhancements are
// queued separately and do not consume this whole window.
export const maxDuration = 300;

const MAX_BODY_BYTES = 512_000;
const MAX_RAW_CONTENT_CHARS = 100_000;
const MAX_EXISTING_CONCEPTS = 500;

/**
 * Ingest a raw source document (markdown, link, free text) and return the
 * extracted/updated concept set. Pipes the payload to the server-side LLM
 * ingest pipeline (`ingestSourceToServerDb`), which normalises categories,
 * stores the source row, and merges concepts into the SQLite-backed Wiki.
 *
 * Body: `IngestRequest` — `source.rawContent` is required (<= 100k chars).
 * Optional `existingConcepts` (<= 500) hints the LLM about prior concepts.
 *
 * Guards: admin token, LLM rate limit, 512KB body cap.
 */
export const POST = withRequestTracing(async (req: Request) => {
  const denied =
    requireAdmin(req) || llmRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = await readJsonWithLimit<IngestRequest>(req, MAX_BODY_BYTES);
    if (!body?.source) {
      return NextResponse.json({ error: 'source is required' }, { status: 400 });
    }
    if (!body.source.rawContent) {
      return NextResponse.json({ error: 'source.rawContent is required' }, { status: 400 });
    }
    if (body.source.rawContent.length > MAX_RAW_CONTENT_CHARS) {
      return NextResponse.json(
        { error: `source.rawContent is too long. Max ${MAX_RAW_CONTENT_CHARS} characters.` },
        { status: 413 },
      );
    }
    if (body.existingConcepts !== undefined && !Array.isArray(body.existingConcepts)) {
      return NextResponse.json({ error: 'existingConcepts must be an array' }, { status: 400 });
    }
    if ((body.existingConcepts || []).length > MAX_EXISTING_CONCEPTS) {
      return NextResponse.json({ error: 'Too many existing concepts' }, { status: 400 });
    }

    const llmConfig = readLlmConfigOverride(req, body);

    const result = await ingestSourceToServerDb({
      title: body.source.title,
      type: body.source.type,
      author: body.source.author,
      url: body.source.url,
      rawContent: body.source.rawContent,
      externalKey: body.source.externalKey,
      llmConfig,
      signal: req.signal,
    });

    try {
      const { queueSourceEnhancementJobs, startAnalysisWorker } =
        await import('@/lib/analysis-worker');
      queueSourceEnhancementJobs({
        sourceId: result.sourceId,
        sourcePath: result.source.title,
      });
      startAnalysisWorker('manual_ingest');
    } catch (error) {
      logger.warn('ingest.post_jobs_queue_failed', {
        sourceId: result.sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(apiError(err, getRequestContext()?.requestId, 'ingest.failed'), {
      status: 500,
    });
  }
});
