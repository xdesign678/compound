import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { startGithubSync } from '@/lib/github-sync-runner';

export const runtime = 'nodejs';
export const maxDuration = 30;

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

async function run(req: Request) {
  const denied = isCronAuthorized(req) ? null : requireAdmin(req);
  if (denied) return denied;
  try {
    const { jobId, existing } = startGithubSync({ triggerType: 'schedule', force: true });
    return NextResponse.json({ jobId, existing: !!existing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Force a full GitHub re-scan. Designed to be invoked from a scheduler
 * (Vercel Cron, GitHub Actions, external uptime ping). Authenticates with
 * either `Authorization: Bearer ${CRON_SECRET}` or the standard admin
 * token. Both `GET` and `POST` are accepted to fit different schedulers.
 */
export const GET = run;
/** See {@link GET}. POST variant for schedulers that prefer non-idempotent verbs. */
export const POST = run;
