import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import {
  enforceContentLength,
  isRequestBodyTooLargeError,
  readJsonWithLimit,
} from '@/lib/request-guards';
import { getServerDb, mutationFailureResponse, parseExpectedRevision, repo } from '@/lib/server-db';
import { requireAdmin } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 64_000;

/**
 * DELETE /api/data/concepts/:id
 * Server-authoritative concept delete. Body (optional): `{ expectedRevision }`.
 *
 * Same transaction, in order: CAS → strip this id from other concepts'
 * `related` arrays → delete the main row → FTS / evidence / relations /
 * versions / category-derived cleanup → sync tombstone.
 * Repeat DELETE is idempotent when a tombstone already exists (no extra
 * tombstone). Never-existed ids return 404.
 *
 * CAS mismatch returns 409
 * `{ code: "revision_conflict", expectedRevision, currentRevision }`.
 * Missing `expectedRevision` follows `COMPOUND_MUTATION_CAS_MODE`
 * (`log-only` default, or `enforce`).
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

    const url = new URL(req.url);
    let expectedRevision: number | undefined;
    try {
      const rawExpectedRevision = Object.prototype.hasOwnProperty.call(body, 'expectedRevision')
        ? body.expectedRevision
        : (url.searchParams.get('expectedRevision') ?? undefined);
      expectedRevision = parseExpectedRevision(rawExpectedRevision);
    } catch (error) {
      const failure = mutationFailureResponse(error);
      if (failure) return NextResponse.json(failure.body, { status: failure.status });
      throw error;
    }

    const result = getServerDb()
      .transaction(() => repo.deleteConcept(conceptId, { expectedRevision, cas: true }))
      .immediate();
    return NextResponse.json({
      deleted: true,
      idempotent: result.outcome === 'already_deleted',
    });
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const failure = mutationFailureResponse(err);
    if (failure) return NextResponse.json(failure.body, { status: failure.status });
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'data.concept_delete_failed'), {
      status: 500,
    });
  }
}
