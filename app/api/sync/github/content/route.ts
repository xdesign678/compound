import { NextResponse } from 'next/server';
import { fetchMarkdownContent, getGithubConfig } from '@/lib/github-sync';
import { requireAdmin } from '@/lib/server-auth';
import { syncRateLimit } from '@/lib/rate-limit';
import { enforceContentLength } from '@/lib/request-guards';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BODY_BYTES = 8_192;

/**
 * POST /api/sync/github/content
 * Body: { path: string }
 * Returns the raw Markdown content of a single file from the configured repo.
 *
 * Uses POST (not GET) so that paths containing special characters
 * do not have to be URL-encoded by the client.
 */
export async function POST(req: Request) {
  const denied =
    requireAdmin(req) || syncRateLimit(req) || enforceContentLength(req, MAX_BODY_BYTES);
  if (denied) return denied;

  try {
    const body = (await req.json()) as { path?: string };
    const path = body?.path?.trim();
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }

    // Paths must be repo-relative Markdown files; no traversal or leading slash.
    if (path.includes('..') || path.startsWith('/') || path.length > 1024 || !/\.md$/i.test(path)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const cfg = getGithubConfig();
    const file = await fetchMarkdownContent(path, cfg);
    return NextResponse.json(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync/github/content] error:', message);
    const status = /not set|Invalid GITHUB_REPO/i.test(message) ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
