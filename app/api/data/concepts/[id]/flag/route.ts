import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { getServerDb, mutationFailureResponse, parseExpectedRevision } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';
import { flagConceptIncorrect } from '@/lib/review-queue';

export const runtime = 'nodejs';
export const maxDuration = 10;

const MAX_BODY_BYTES = 64_000;

/**
 * POST /api/data/concepts/:id/flag
 * Mark a concept as incorrect. Creates a deduplicated server review item
 * and a server activity + sync change in the same transaction, then returns
 * both so the current client can mirror them.
 *
 * Consecutive clicks reuse the open review item and do not enqueue more
 * pending reviews or extra activity. Body (optional): `{ expectedRevision }`.
 *
 * CAS mismatch returns 409
 * `{ code: "revision_conflict", expectedRevision, currentRevision }`.
 * Missing `expectedRevision` follows `COMPOUND_MUTATION_CAS_MODE`
 * (`log-only` default, or `enforce`).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const conceptId = id.trim();
    if (!conceptId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    let body: Record<string, unknown> = {};
    try {
      const parsed = await readJsonWithLimit<unknown>(req, MAX_BODY_BYTES);
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

    let expectedRevision: number | undefined;
    try {
      expectedRevision = parseExpectedRevision(body.expectedRevision);
    } catch (error) {
      const failure = mutationFailureResponse(error);
      if (failure) return NextResponse.json(failure.body, { status: failure.status });
      throw error;
    }

    const result = getServerDb()
      .transaction(() =>
        flagConceptIncorrect({
          conceptId,
          expectedRevision,
          cas: true,
        }),
      )
      .immediate();
    return NextResponse.json({
      created: result.created,
      review: result.review,
      activity: result.activity,
    });
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const failure = mutationFailureResponse(err);
    if (failure) return NextResponse.json(failure.body, { status: failure.status });
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'data.concept_flag_failed'), {
      status: 500,
    });
  }
}
