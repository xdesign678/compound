import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/health/live
 * Process liveness only. Does not inspect SQLite, volumes, or workers.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok', probe: 'live' });
}
