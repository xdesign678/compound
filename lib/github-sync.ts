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
import { logger } from './logging';
import { buildOutboundTraceHeaders } from './request-context';
import { parseRateLimitBackoffMs } from './llm-rate-headers';

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

export interface GithubChangedFile {
  path: string;
  sha: string | null;
  size: number;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  previousPath?: string;
  externalKey: string | null;
}

export interface GithubFileContent {
  path: string;
  sha: string;
  content: string;
  externalKey: string;
}

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_BRANCH = 'main';
const DEFAULT_MAX_MARKDOWN_BYTES = 2_000_000;

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const GITHUB_FETCH_TIMEOUT_MS = readPositiveInt(
  process.env.COMPOUND_GITHUB_FETCH_TIMEOUT_MS,
  30_000,
);
let githubRateLimitBackoffUntil = 0;

export function githubMarkdownSizeLimit(): number {
  return readPositiveInt(process.env.COMPOUND_GITHUB_MAX_FILE_BYTES, DEFAULT_MAX_MARKDOWN_BYTES);
}

export function isGithubMarkdownFileTooLarge(size: number | null | undefined): boolean {
  return Number.isFinite(size) && Number(size) > githubMarkdownSizeLimit();
}

function assertMarkdownFileSize(path: string, size: number | null | undefined): void {
  if (!isGithubMarkdownFileTooLarge(size)) return;
  throw new Error(
    `Markdown file ${path} exceeds GitHub markdown size limit (${size} > ${githubMarkdownSizeLimit()} bytes)`,
  );
}

async function waitForGithubRateLimitBackoff(): Promise<void> {
  const delay = githubRateLimitBackoffUntil - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}

function applyGithubRateLimitHeaders(headers: Headers): void {
  const backoffMs = parseRateLimitBackoffMs(headers, {
    remainingThreshold: readPositiveInt(process.env.COMPOUND_GITHUB_RATE_REMAINING_THRESHOLD, 5),
    defaultBackoffMs: 0,
  });
  if (backoffMs == null) return;
  githubRateLimitBackoffUntil = Math.max(githubRateLimitBackoffUntil, Date.now() + backoffMs);
  logger.warn('github_sync.rate_limit_backoff', { backoffMs });
}

function encodeContentPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function shouldSkipPath(path: string): boolean {
  return path.startsWith('.obsidian/') || path.startsWith('.trash/');
}

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
  await waitForGithubRateLimitBackoff();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'compound-sync/1.0',
      ...buildOutboundTraceHeaders(),
    },
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
  applyGithubRateLimitHeaders(res.headers);
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

interface GithubContentsItem {
  path: string;
  sha: string;
  size?: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

async function getBranchHead(cfg: GithubConfig): Promise<{ commitSha: string; treeSha: string }> {
  const refUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`;
  const refRes = await githubFetch(refUrl, cfg);
  const refData = (await refRes.json()) as {
    commit: { sha: string; commit: { tree: { sha: string } } };
  };
  return {
    commitSha: refData.commit.sha,
    treeSha: refData.commit.commit.tree.sha,
  };
}

export async function getGithubBranchHeadSha(
  cfg: GithubConfig = getGithubConfig(),
): Promise<string> {
  return (await getBranchHead(cfg)).commitSha;
}

async function listMarkdownFilesViaContents(
  cfg: GithubConfig,
  dir = '',
): Promise<GithubMarkdownFile[]> {
  const encoded = dir ? `/${encodeContentPath(dir)}` : '';
  const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents${encoded}?ref=${encodeURIComponent(
    cfg.branch,
  )}`;
  const res = await githubFetch(url, cfg);
  const data = (await res.json()) as GithubContentsItem[] | GithubContentsItem;
  const items = Array.isArray(data) ? data : [data];
  const out: GithubMarkdownFile[] = [];

  for (const item of items) {
    if (shouldSkipPath(`${item.path}/`)) continue;
    if (item.type === 'dir') {
      out.push(...(await listMarkdownFilesViaContents(cfg, item.path)));
      continue;
    }
    if (item.type !== 'file' || !/\.md$/i.test(item.path)) continue;
    out.push({
      path: item.path,
      sha: item.sha,
      size: item.size ?? 0,
      externalKey: buildExternalKey(cfg, item.path, item.sha),
    });
  }
  return out;
}

/**
 * List every Markdown file under the configured branch.
 * Uses the git tree API to fetch the entire repository in a single call.
 */
export async function listMarkdownFiles(
  cfg: GithubConfig = getGithubConfig(),
): Promise<GithubMarkdownFile[]> {
  // 1. Resolve the branch head commit SHA.
  const { treeSha } = await getBranchHead(cfg);

  // 2. Walk the tree recursively (single request, up to 100k entries).
  const treeUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/git/trees/${treeSha}?recursive=1`;
  const treeRes = await githubFetch(treeUrl, cfg);
  const treeData = (await treeRes.json()) as { tree: GithubTreeItem[]; truncated: boolean };

  if (treeData.truncated) {
    logger.warn('github_sync.tree_truncated', {
      repo: `${cfg.owner}/${cfg.repo}`,
      branch: cfg.branch,
      recommendation: 'Falling back to contents API traversal to avoid silently missing files.',
    });
    return listMarkdownFilesViaContents(cfg);
  }

  const files: GithubMarkdownFile[] = [];
  for (const item of treeData.tree) {
    if (item.type !== 'blob') continue;
    if (!/\.md$/i.test(item.path)) continue;
    // Skip obvious noise
    if (shouldSkipPath(item.path)) continue;
    files.push({
      path: item.path,
      sha: item.sha,
      size: item.size,
      externalKey: buildExternalKey(cfg, item.path, item.sha),
    });
  }
  return files;
}

function normalizeCompareFile(
  cfg: GithubConfig,
  file: {
    filename: string;
    previous_filename?: string;
    sha?: string;
    status: string;
  },
): GithubChangedFile | null {
  if (!['added', 'modified', 'removed', 'renamed'].includes(file.status)) return null;
  if (file.status === 'renamed') {
    const oldIsMarkdown = Boolean(file.previous_filename && /\.md$/i.test(file.previous_filename));
    const newIsMarkdown = /\.md$/i.test(file.filename);
    if (oldIsMarkdown && !newIsMarkdown) {
      if (shouldSkipPath(file.previous_filename!)) return null;
      return {
        path: file.previous_filename!,
        previousPath: file.previous_filename,
        sha: null,
        size: 0,
        status: 'removed',
        externalKey: null,
      };
    }
    if (!oldIsMarkdown && newIsMarkdown) {
      if (shouldSkipPath(file.filename)) return null;
      const sha = file.sha ?? null;
      return {
        path: file.filename,
        previousPath: file.previous_filename,
        sha,
        size: 0,
        status: 'added',
        externalKey: sha ? buildExternalKey(cfg, file.filename, sha) : null,
      };
    }
  }
  const candidatePath =
    /\.md$/i.test(file.filename) || file.status !== 'renamed'
      ? file.filename
      : (file.previous_filename ?? file.filename);
  if (!/\.md$/i.test(candidatePath)) return null;
  if (shouldSkipPath(candidatePath) || shouldSkipPath(file.filename)) return null;
  const sha = file.status === 'removed' ? null : (file.sha ?? null);
  return {
    path: file.filename,
    previousPath: file.previous_filename,
    sha,
    size: 0,
    status: file.status as GithubChangedFile['status'],
    externalKey: sha ? buildExternalKey(cfg, file.filename, sha) : null,
  };
}

export async function listChangedSinceCommit(
  baseSha: string,
  headSha: string,
  cfg: GithubConfig = getGithubConfig(),
): Promise<GithubChangedFile[]> {
  const files: GithubChangedFile[] = [];
  let page = 1;
  while (true) {
    const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/compare/${encodeURIComponent(
      baseSha,
    )}...${encodeURIComponent(headSha)}?per_page=100&page=${page}`;
    const res = await githubFetch(url, cfg);
    const data = (await res.json()) as {
      files?: Array<{
        filename: string;
        previous_filename?: string;
        sha?: string;
        status: string;
      }>;
    };
    const pageFiles = data.files ?? [];
    for (const file of pageFiles) {
      const normalized = normalizeCompareFile(cfg, file);
      if (normalized) files.push(normalized);
    }
    if (pageFiles.length < 100) break;
    page += 1;
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
  const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeContentPath(
    path,
  )}?ref=${encodeURIComponent(cfg.branch)}`;

  if (knownSha) {
    const rawRes = await githubFetch(url, cfg, 'application/vnd.github.raw');
    const contentLength = Number(rawRes.headers.get('content-length') || 0);
    if (contentLength > 0) assertMarkdownFileSize(path, contentLength);
    const content = await rawRes.text();
    assertMarkdownFileSize(path, Buffer.byteLength(content, 'utf8'));
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
  assertMarkdownFileSize(meta.path, meta.size);

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
