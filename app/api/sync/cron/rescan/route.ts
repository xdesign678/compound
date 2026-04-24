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

export const GET = run;
export const POST = run;
