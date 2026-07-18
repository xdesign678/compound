import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAdmin, safeEqual } from '@/lib/server-auth';
import { startGithubSync } from '@/lib/github-sync-runner';

export const runtime = 'nodejs';
export const maxDuration = 30;

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  const bearerPrefix = 'Bearer ';
  if (!auth.startsWith(bearerPrefix)) return false;
  return safeEqual(auth.slice(bearerPrefix.length).trim(), secret);
}

async function run(req: Request, options: { allowAdmin: boolean }) {
  const denied = isCronAuthorized(req) ? null : options.allowAdmin ? requireAdmin(req) : null;
  if (!options.allowAdmin && !isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (denied) return denied;
  try {
    // Scheduled safety scans should detect changes without re-running LLM work
    // for every unchanged file. A force rebuild stays available as an explicit
    // POST /api/sync/cron/rescan?force=true maintenance action.
    const force =
      options.allowAdmin && new URL(req.url).searchParams.get('force')?.toLowerCase() === 'true';
    const { jobId, existing } = startGithubSync({ triggerType: 'schedule', force });
    return NextResponse.json({ jobId, existing: !!existing });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'sync.cron.rescan.failed'), { status: 500 });
  }
}

/**
 * Incrementally re-scan GitHub. Designed to be invoked from a scheduler
 * (Vercel Cron, GitHub Actions, external uptime ping). Authenticates with
 * either `Authorization: Bearer ${CRON_SECRET}` or the standard admin
 * token. `GET` is reserved for cron-secret callers; admin-triggered POST may
 * opt into a full rebuild with `?force=true`.
 */
export const GET = (req: Request) => run(req, { allowAdmin: false });
/** See {@link GET}. POST variant for schedulers that prefer non-idempotent verbs. */
export const POST = (req: Request) => run(req, { allowAdmin: true });
