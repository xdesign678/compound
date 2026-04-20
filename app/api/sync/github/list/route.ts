import { NextResponse } from 'next/server';
import { listMarkdownFiles, getGithubConfig } from '@/lib/github-sync';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/sync/github/list
 * Returns every Markdown file (path + sha + size) in the configured GitHub repo.
 * The client uses this list to diff against its local Sources and decide what to ingest.
 */
export async function GET() {
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
    console.error('[sync/github/list] error:', message);
    const status = /not set|Invalid GITHUB_REPO/i.test(message) ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
