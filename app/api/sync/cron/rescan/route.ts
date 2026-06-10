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
    const { jobId, existing } = startGithubSync({ triggerType: 'schedule', force: true });
    return NextResponse.json({ jobId, existing: !!existing });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'sync.cron.rescan.failed'), { status: 500 });
  }
}

/**
 * Force a full GitHub re-scan. Designed to be invoked from a scheduler
 * (Vercel Cron, GitHub Actions, external uptime ping). Authenticates with
 * either `Authorization: Bearer ${CRON_SECRET}` or the standard admin
 * token. `GET` is reserved for cron-secret callers; admin-triggered runs use POST.
 */
export const GET = (req: Request) => run(req, { allowAdmin: false });
/** See {@link GET}. POST variant for schedulers that prefer non-idempotent verbs. */
export const POST = (req: Request) => run(req, { allowAdmin: true });
