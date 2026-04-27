import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { cancelGithubSync } from '@/lib/github-sync-runner';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  try {
    const result = cancelGithubSync();
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
