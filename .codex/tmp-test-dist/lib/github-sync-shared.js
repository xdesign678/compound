"use strict";
/**
 * GitHub 同步相关的纯工具函数 —— 前后端共享。
 * 不依赖 Node.js 或浏览器 API，可在 Edge / browser / server 任意环境使用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExternalKey = buildExternalKey;
exports.parseExternalKey = parseExternalKey;
exports.externalKeyPath = externalKeyPath;
function buildExternalKey(cfg, path, sha) {
    return `github:${cfg.owner}/${cfg.repo}:${path}@${sha}`;
}
function parseExternalKey(key) {
    const match = key.match(/^github:([^/]+)\/([^:]+):(.+)@([^@]+)$/);
    if (!match)
        return null;
    return { owner: match[1], repo: match[2], path: match[3], sha: match[4] };
}
/** Extract only the path from an externalKey (for dedup by path, ignoring sha). */
function externalKeyPath(key) {
    return parseExternalKey(key)?.path ?? null;
}
