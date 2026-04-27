/**
 * Server-side helpers for syncing Markdown files from a GitHub repository.
 *
 * Required env vars:
 *   GITHUB_REPO    – "owner/repo" slug, e.g. "xdesign678/myobs"
 *   GITHUB_TOKEN   – fine-grained personal access token with Contents:Read
 *   GITHUB_BRANCH  – branch name (default: "main")
 *
 * Never runs in the browser — `GITHUB_TOKEN` must never reach the client.
 */

import { buildExternalKey } from './github-sync-shared';

export { buildExternalKey, parseExternalKey, externalKeyPath } from './github-sync-shared';

export interface GithubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface GithubTreeItem {
  path: string;
  sha: string;
  size: number;
  type: 'blob' | 'tree';
}

export interface GithubMarkdownFile {
  path: string;
  sha: string;
  size: number;
  /** Convenience key matching Source.externalKey format. */
  externalKey: string;
}

export interface GithubFileContent {
  path: string;
  sha: string;
  content: string;
  externalKey: string;
}

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_BRANCH = 'main';

function parseRepoSlug(raw: string): { owner: string; repo: string } {
  const cleaned = raw.trim().replace(/\.git$/, '');
  // Support full URLs: https://github.com/owner/repo
  const match =
    cleaned.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/|$)/) ||
    cleaned.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid GITHUB_REPO: "${raw}" — expected "owner/repo" or a github.com URL`);
  }
  return { owner: match[1], repo: match[2] };
}

export function getGithubConfig(): GithubConfig {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repo = process.env.GITHUB_REPO?.trim();
  const branch = process.env.GITHUB_BRANCH?.trim() || DEFAULT_BRANCH;

  if (!token) throw new Error('GITHUB_TOKEN is not set');
  if (!repo) throw new Error('GITHUB_REPO is not set');

  const { owner, repo: repoName } = parseRepoSlug(repo);
  return { owner, repo: repoName, branch, token };
}

async function githubFetch(
  url: string,
  cfg: GithubConfig,
  accept = 'application/vnd.github+json',
): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'compound-sync/1.0',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(
      `GitHub ${res.status} at ${new URL(url).pathname}` +
        (remaining === '0' ? ' (rate limit exhausted)' : '') +
        (text ? `: ${text.slice(0, 300)}` : ''),
    );
  }
  return res;
}

/**
 * List every Markdown file under the configured branch.
 * Uses the git tree API to fetch the entire repository in a single call.
 */
export async function listMarkdownFiles(
  cfg: GithubConfig = getGithubConfig(),
): Promise<GithubMarkdownFile[]> {
  // 1. Resolve the branch head commit SHA.
  const refUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`;
  const refRes = await githubFetch(refUrl, cfg);
  const refData = (await refRes.json()) as {
    commit: { sha: string; commit: { tree: { sha: string } } };
  };
  const treeSha = refData.commit.commit.tree.sha;

  // 2. Walk the tree recursively (single request, up to 100k entries).
  const treeUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/git/trees/${treeSha}?recursive=1`;
  const treeRes = await githubFetch(treeUrl, cfg);
  const treeData = (await treeRes.json()) as { tree: GithubTreeItem[]; truncated: boolean };

  if (treeData.truncated) {
    console.warn(
      `[github-sync] Tree for ${cfg.owner}/${cfg.repo} was truncated; very large vaults may need pagination.`,
    );
  }

  const files: GithubMarkdownFile[] = [];
  for (const item of treeData.tree) {
    if (item.type !== 'blob') continue;
    if (!/\.md$/i.test(item.path)) continue;
    // Skip obvious noise
    if (item.path.startsWith('.obsidian/')) continue;
    if (item.path.startsWith('.trash/')) continue;
    files.push({
      path: item.path,
      sha: item.sha,
      size: item.size,
      externalKey: buildExternalKey(cfg, item.path, item.sha),
    });
  }
  return files;
}

/**
 * Fetch the raw Markdown content of a single file.
 */
export async function fetchMarkdownContent(
  path: string,
  cfg: GithubConfig = getGithubConfig(),
  knownSha?: string,
): Promise<GithubFileContent> {
  const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(
    path,
  )}?ref=${encodeURIComponent(cfg.branch)}`;

  if (knownSha) {
    const rawRes = await githubFetch(url, cfg, 'application/vnd.github.raw');
    const content = await rawRes.text();
    return {
      path,
      sha: knownSha,
      content,
      externalKey: buildExternalKey(cfg, path, knownSha),
    };
  }

  // Request metadata first (gives us the sha), then stream raw bytes.
  const metaRes = await githubFetch(url, cfg);
  const meta = (await metaRes.json()) as {
    sha: string;
    encoding?: string;
    content?: string;
    path: string;
    size: number;
  };

  // Some files are small enough to be inlined as base64; use that when available.
  let content: string;
  if (meta.encoding === 'base64' && typeof meta.content === 'string') {
    content = Buffer.from(meta.content, 'base64').toString('utf-8');
  } else {
    const rawRes = await githubFetch(url, cfg, 'application/vnd.github.raw');
    content = await rawRes.text();
  }

  return {
    path: meta.path,
    sha: meta.sha,
    content,
    externalKey: buildExternalKey(cfg, meta.path, meta.sha),
  };
}
