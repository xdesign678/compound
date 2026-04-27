import { NextResponse } from 'next/server';
import { listMarkdownFiles, getGithubConfig } from '@/lib/github-sync';
import { logger } from '@/lib/logging';
import { requireAdmin } from '@/lib/server-auth';
import { syncRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/sync/github/list
 * Returns every Markdown file (path + sha + size) in the configured GitHub repo.
 * The client uses this list to diff against its local Sources and decide what to ingest.
 */
export async function GET(req: Request) {
  const denied = requireAdmin(req) || syncRateLimit(req);
  if (denied) return denied;

  try {
    const cfg = getGithubConfig();
    const files = await listMarkdownFiles(cfg);
    return NextResponse.json({
      repo: `${cfg.owner}/${cfg.repo}`,
      branch: cfg.branch,
      count: files.length,
      files,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('sync.github_list_failed', { error: message });
    const status = /not set|Invalid GITHUB_REPO/i.test(message) ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
