import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { escapeHTML } from '@/lib/format';
import { logger } from '@/lib/logging';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import {
  assertWritableRevision,
  DEFAULT_SERVER_REVISION,
  EntityNotFoundError,
  getServerDb,
  mutationFailureResponse,
  parseExpectedRevision,
  repo,
} from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';
import { recompileSourceArtifactsAfterEdit } from '@/lib/wiki-compiler';
import type { ActivityLog, Source } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_IDS = 200;
const MAX_PATCH_BODY_BYTES = 512_000;
const MAX_RAW_CONTENT_CHARS = 120_000;

function parseIdsParam(value: string | null): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * GET /api/data/sources?ids=s-1,s-2
 * Returns full source documents for on-demand hydration.
 * Each source includes `serverRevision` (monotonic server mutation token).
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const url = new URL(req.url);
    const ids = parseIdsParam(url.searchParams.get('ids'));
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids is required' }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Too many ids (max ${MAX_IDS})`, received: ids.length, max: MAX_IDS },
        { status: 413 },
      );
    }

    return NextResponse.json({
      sources: repo.getSourcesByIds(ids),
    });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'data.sources_failed'), { status: 500 });
  }
}

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * PATCH /api/data/sources
 * Updates a source document and recompiles retrieval artifacts for all
 * concepts backed by that source.
 * Body: `{ id, rawContent, title?, expectedRevision? }`.
 *
 * CAS: `expectedRevision` is compared in the same transaction before any
 * index / activity / analysis-job side effects. Mismatch returns 409
 * `{ code: "revision_conflict", expectedRevision, currentRevision }`.
 * Missing `expectedRevision` follows `COMPOUND_MUTATION_CAS_MODE`
 * (`log-only` default, or `enforce`).
 */
export async function PATCH(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_PATCH_BODY_BYTES);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      const parsed = await readJsonWithLimit<unknown>(req, MAX_PATCH_BODY_BYTES);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json(
          { error: 'Request body must be a JSON object', code: 'invalid_json' },
          { status: 400 },
        );
      }
      body = parsed as Record<string, unknown>;
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) throw error;
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'invalid_json' },
        { status: 400 },
      );
    }
    const id = clampString(body.id, 120);
    const rawContent = clampText(body.rawContent, MAX_RAW_CONTENT_CHARS);
    const title = clampString(body.title, 180);
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!rawContent) {
      return NextResponse.json({ error: 'rawContent is required' }, { status: 400 });
    }

    let expectedRevision: number | undefined;
    try {
      expectedRevision = parseExpectedRevision(body.expectedRevision);
    } catch (error) {
      const failure = mutationFailureResponse(error);
      if (failure) return NextResponse.json(failure.body, { status: failure.status });
      throw error;
    }

    let compiler: ReturnType<typeof recompileSourceArtifactsAfterEdit> | undefined;
    let nextSource: Source | undefined;
    let activity: ActivityLog | undefined;
    try {
      const trx = getServerDb().transaction(() => {
        const existing = repo.getSource(id);
        if (!existing) throw new EntityNotFoundError('source', id);
        assertWritableRevision(
          'source',
          id,
          expectedRevision,
          existing.serverRevision ?? DEFAULT_SERVER_REVISION,
        );

        nextSource = {
          ...existing,
          title: title || existing.title,
          rawContent,
          updatedAt: Date.now(),
        };
        activity = {
          id: `a-${nanoid(8)}`,
          type: 'ingest',
          title: `更新资料 <em>${escapeHTML(nextSource.title)}</em>`,
          details: '手动编辑资料正文后重建 chunk、证据链与检索索引。',
          relatedSourceIds: [nextSource.id],
          at: Date.now(),
        };
        repo.insertSource(nextSource);
        compiler = recompileSourceArtifactsAfterEdit({
          source: nextSource,
          changeSummary: `资料「${nextSource.title}」手动编辑后重建索引。`,
        });
        repo.insertActivity({
          ...activity,
          relatedConceptIds: compiler?.affectedConceptIds ?? [],
        });
      });
      trx.immediate();
    } catch (error) {
      const failure = mutationFailureResponse(error);
      if (failure) return NextResponse.json(failure.body, { status: failure.status });
      throw error;
    }

    if (!nextSource || !activity) {
      return NextResponse.json({ error: 'source not found' }, { status: 404 });
    }

    try {
      const { queueSourceEnhancementJobs, startAnalysisWorker } =
        await import('@/lib/analysis-worker');
      queueSourceEnhancementJobs({
        sourceId: nextSource.id,
        sourcePath: nextSource.title,
      });
      startAnalysisWorker('source_edit');
    } catch (error) {
      logger.warn('data.sources_post_jobs_queue_failed', {
        sourceId: nextSource.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json({
      source: repo.getSource(nextSource.id) ?? nextSource,
      concepts: repo.getConceptsByIds(compiler?.affectedConceptIds ?? []),
      activity: {
        ...activity,
        relatedConceptIds: compiler?.affectedConceptIds ?? [],
      },
      compiler,
    });
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const failure = mutationFailureResponse(err);
    if (failure) return NextResponse.json(failure.body, { status: failure.status });
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'data.sources_patch_failed'), {
      status: 500,
    });
  }
}
