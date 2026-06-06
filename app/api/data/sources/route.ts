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
import { getServerDb, repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';
import { recompileSourceArtifactsAfterEdit } from '@/lib/wiki-compiler';
import {
  RELATION_EXTRACT_SYSTEM_PROMPT_VERSION,
  SOURCE_SUMMARY_SYSTEM_PROMPT_VERSION,
} from '@/lib/prompts';
import { getModelForTask } from '@/lib/model-history';
import type { ActivityLog } from '@/lib/types';

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
 * concepts backed by that source. Body: `{ id, rawContent, title? }`.
 */
export async function PATCH(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_PATCH_BODY_BYTES);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonWithLimit<Record<string, unknown>>(req, MAX_PATCH_BODY_BYTES);
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) throw error;
      body = {};
    }
    const id = clampString(body.id, 120);
    const rawContent = clampText(body.rawContent, MAX_RAW_CONTENT_CHARS);
    const title = clampString(body.title, 180);
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!rawContent) {
      return NextResponse.json({ error: 'rawContent is required' }, { status: 400 });
    }

    const existing = repo.getSource(id);
    if (!existing) return NextResponse.json({ error: 'source not found' }, { status: 404 });

    const nextSource = {
      ...existing,
      title: title || existing.title,
      rawContent,
    };
    const activity: ActivityLog = {
      id: `a-${nanoid(8)}`,
      type: 'ingest',
      title: `更新资料 <em>${escapeHTML(nextSource.title)}</em>`,
      details: '手动编辑资料正文后重建 chunk、证据链与检索索引。',
      relatedSourceIds: [nextSource.id],
      at: Date.now(),
    };

    let compiler: ReturnType<typeof recompileSourceArtifactsAfterEdit> | undefined;
    const trx = getServerDb().transaction(() => {
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
    trx();

    try {
      const { queueAdvancedAnalysisJob, startAnalysisWorker } =
        await import('@/lib/analysis-worker');
      for (const stage of ['embedding', 'summarize', 'relations'] as const) {
        queueAdvancedAnalysisJob({
          sourceId: nextSource.id,
          sourcePath: nextSource.title,
          stage,
          model:
            stage === 'summarize'
              ? getModelForTask('source_summarize')
              : stage === 'relations'
                ? getModelForTask('relation_extract')
                : null,
          promptVersion:
            stage === 'summarize'
              ? SOURCE_SUMMARY_SYSTEM_PROMPT_VERSION
              : RELATION_EXTRACT_SYSTEM_PROMPT_VERSION,
          priority: stage === 'embedding' ? 40 : stage === 'summarize' ? 20 : 15,
          maxAttempts: stage === 'embedding' ? 3 : 2,
        });
      }
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
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'data.sources_patch_failed'), {
      status: 500,
    });
  }
}
