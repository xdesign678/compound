import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logger } from '@/lib/logging';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/data/concepts/:id/versions
 * Returns AI-maintained edit history for a concept.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    if (!id.trim()) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    return NextResponse.json({
      versions: wikiRepo.getConceptVersions(id),
    });
  } catch (error) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(error, requestId, 'data.concept_versions_failed'), {
      status: 500,
    });
  }
}
