"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.externalKeyPath = exports.parseExternalKey = exports.buildExternalKey = void 0;
exports.getGithubConfig = getGithubConfig;
exports.listMarkdownFiles = listMarkdownFiles;
exports.fetchMarkdownContent = fetchMarkdownContent;
const github_sync_shared_1 = require("./github-sync-shared");
var github_sync_shared_2 = require("./github-sync-shared");
Object.defineProperty(exports, "buildExternalKey", { enumerable: true, get: function () { return github_sync_shared_2.buildExternalKey; } });
Object.defineProperty(exports, "parseExternalKey", { enumerable: true, get: function () { return github_sync_shared_2.parseExternalKey; } });
Object.defineProperty(exports, "externalKeyPath", { enumerable: true, get: function () { return github_sync_shared_2.externalKeyPath; } });
const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_BRANCH = 'main';
function parseRepoSlug(raw) {
    const cleaned = raw.trim().replace(/\.git$/, '');
    // Support full URLs: https://github.com/owner/repo
    const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/|$)/) ||
        cleaned.match(/^([^/]+)\/([^/]+)$/);
    if (!match) {
        throw new Error(`Invalid GITHUB_REPO: "${raw}" — expected "owner/repo" or a github.com URL`);
    }
    return { owner: match[1], repo: match[2] };
}
function getGithubConfig() {
    const token = process.env.GITHUB_TOKEN?.trim();
    const repo = process.env.GITHUB_REPO?.trim();
    const branch = process.env.GITHUB_BRANCH?.trim() || DEFAULT_BRANCH;
    if (!token)
        throw new Error('GITHUB_TOKEN is not set');
    if (!repo)
        throw new Error('GITHUB_REPO is not set');
    const { owner, repo: repoName } = parseRepoSlug(repo);
    return { owner, repo: repoName, branch, token };
}
async function githubFetch(url, cfg, accept = 'application/vnd.github+json') {
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
        throw new Error(`GitHub ${res.status} at ${new URL(url).pathname}` +
            (remaining === '0' ? ' (rate limit exhausted)' : '') +
            (text ? `: ${text.slice(0, 300)}` : ''));
    }
    return res;
}
/**
 * List every Markdown file under the configured branch.
 * Uses the git tree API to fetch the entire repository in a single call.
 */
async function listMarkdownFiles(cfg = getGithubConfig()) {
    // 1. Resolve the branch head commit SHA.
    const refUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`;
    const refRes = await githubFetch(refUrl, cfg);
    const refData = (await refRes.json());
    const treeSha = refData.commit.commit.tree.sha;
    // 2. Walk the tree recursively (single request, up to 100k entries).
    const treeUrl = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/git/trees/${treeSha}?recursive=1`;
    const treeRes = await githubFetch(treeUrl, cfg);
    const treeData = (await treeRes.json());
    if (treeData.truncated) {
        console.warn(`[github-sync] Tree for ${cfg.owner}/${cfg.repo} was truncated; very large vaults may need pagination.`);
    }
    const files = [];
    for (const item of treeData.tree) {
        if (item.type !== 'blob')
            continue;
        if (!/\.md$/i.test(item.path))
            continue;
        // Skip obvious noise
        if (item.path.startsWith('.obsidian/'))
            continue;
        if (item.path.startsWith('.trash/'))
            continue;
        files.push({
            path: item.path,
            sha: item.sha,
            size: item.size,
            externalKey: (0, github_sync_shared_1.buildExternalKey)(cfg, item.path, item.sha),
        });
    }
    return files;
}
/**
 * Fetch the raw Markdown content of a single file.
 */
async function fetchMarkdownContent(path, cfg = getGithubConfig(), knownSha) {
    const url = `${GITHUB_API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(cfg.branch)}`;
    if (knownSha) {
        const rawRes = await githubFetch(url, cfg, 'application/vnd.github.raw');
        const content = await rawRes.text();
        return {
            path,
            sha: knownSha,
            content,
            externalKey: (0, github_sync_shared_1.buildExternalKey)(cfg, path, knownSha),
        };
    }
    // Request metadata first (gives us the sha), then stream raw bytes.
    const metaRes = await githubFetch(url, cfg);
    const meta = (await metaRes.json());
    // Some files are small enough to be inlined as base64; use that when available.
    let content;
    if (meta.encoding === 'base64' && typeof meta.content === 'string') {
        content = Buffer.from(meta.content, 'base64').toString('utf-8');
    }
    else {
        const rawRes = await githubFetch(url, cfg, 'application/vnd.github.raw');
        content = await rawRes.text();
    }
    return {
        path: meta.path,
        sha: meta.sha,
        content,
        externalKey: (0, github_sync_shared_1.buildExternalKey)(cfg, meta.path, meta.sha),
    };
}
