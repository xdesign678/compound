import { NextResponse } from 'next/server';
import { startGithubSync } from '@/lib/github-sync-runner';

export const runtime = 'nodejs';
// Background loop stays alive beyond this — we respond immediately.
export const maxDuration = 30;

/**
 * POST /api/sync/github/run
 * Starts a server-side GitHub → SQLite sync job and returns the job id.
 * The actual work runs in the background; client polls `/api/sync/status`.
 */
export async function POST() {
  try {
    const { jobId, existing } = startGithubSync();
    return NextResponse.json({ jobId, existing: !!existing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync/github/run] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
