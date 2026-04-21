"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const github_sync_1 = require("./github-sync");
(0, node_test_1.default)('fetches markdown content with a known sha in a single network request', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        calls.push({
            url,
            accept: init?.headers?.Accept ?? null,
        });
        return new Response('# Hello', {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
    });
    try {
        const result = await github_sync_1.fetchMarkdownContent('notes/test.md', { owner: 'demo', repo: 'vault', branch: 'main', token: 'secret' }, 'sha-123');
        strict_1.default.equal(calls.length, 1);
        strict_1.default.match(calls[0]?.url ?? '', /\/contents\/notes\/test\.md\?ref=main$/);
        strict_1.default.equal(result.sha, 'sha-123');
        strict_1.default.equal(result.externalKey, 'github:demo/vault:notes/test.md@sha-123');
        strict_1.default.equal(result.content, '# Hello');
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
