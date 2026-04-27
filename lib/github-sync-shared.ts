/**
 * GitHub 同步相关的纯工具函数 —— 前后端共享。
 * 不依赖 Node.js 或浏览器 API，可在 Edge / browser / server 任意环境使用。
 */

export function buildExternalKey(
  cfg: { owner: string; repo: string },
  path: string,
  sha: string,
): string {
  return `github:${cfg.owner}/${cfg.repo}:${path}@${sha}`;
}

export function parseExternalKey(
  key: string,
): { owner: string; repo: string; path: string; sha: string } | null {
  const match = key.match(/^github:([^/]+)\/([^:]+):(.+)@([^@]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], path: match[3], sha: match[4] };
}

/** Extract only the path from an externalKey (for dedup by path, ignoring sha). */
export function externalKeyPath(key: string): string | null {
  return parseExternalKey(key)?.path ?? null;
}
