import { NextResponse } from 'next/server';
import { fetchMarkdownContent, getGithubConfig } from '@/lib/github-sync';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/sync/github/content
 * Body: { path: string }
 * Returns the raw Markdown content of a single file from the configured repo.
 *
 * Uses POST (not GET) so that paths containing special characters
 * do not have to be URL-encoded by the client.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { path?: string };
    const path = body?.path?.trim();
    if (!path) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 });
    }
    // Basic sanity checks — paths must be repo-relative, no traversal, no leading slash.
    if (path.includes('..') || path.startsWith('/') || path.length > 1024) {
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
