import { NextResponse } from 'next/server';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { requireAdmin } from '@/lib/server-auth';
import { ArchiveAnswerError, archiveAnswerAsDraft } from '@/lib/query-provenance';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 256_000;
const MAX_TITLE_CHARS = 80;
const MAX_SUMMARY_CHARS = 240;
const MAX_ANSWER_CHARS = 60_000;
const MAX_CITED_CONCEPTS = 80;

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
        .slice(0, MAX_CITED_CONCEPTS),
    ),
  );
}

/**
 * Archive an Ask answer as a derived draft Wiki concept. The new concept,
 * provenance, open review item, activity, and sync change share one SQLite
 * transaction. Drafts stay visible for review but are excluded from retrieval
 * until approved.
 */
export async function POST(req: Request) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await readJsonWithLimit<Record<string, unknown>>(req, MAX_BODY_BYTES);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    body = {};
  }
  const title = clampString(body.title, MAX_TITLE_CHARS) || '新归档概念';
  const summary = clampString(body.summary, MAX_SUMMARY_CHARS) || title;
  const answerBody = clampString(body.body, MAX_ANSWER_CHARS);
  const citedConceptIds = normalizeIds(body.citedConceptIds);
  const queryRunId = clampString(body.queryRunId, 80);

  if (!answerBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  if (citedConceptIds.length === 0 && !queryRunId) {
    return NextResponse.json({ error: 'citedConceptIds is required' }, { status: 400 });
  }

  try {
    const result = archiveAnswerAsDraft({
      title,
      summary,
      body: answerBody,
      citedConceptIds,
      queryRunId: queryRunId || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ArchiveAnswerError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'concept_provenance requires an existing concept') {
      return NextResponse.json({ error: 'failed to persist draft provenance' }, { status: 500 });
    }
    return NextResponse.json({ error: 'failed to archive answer' }, { status: 500 });
  }
}
