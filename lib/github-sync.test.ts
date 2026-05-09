import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchMarkdownContent, listMarkdownFiles } from './github-sync';

test('fetches markdown content with a known sha in a single network request', async () => {
  const calls: Array<{ url: string; accept: string | null }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      accept: (init?.headers as Record<string, string> | undefined)?.Accept ?? null,
    });

    return new Response('# Hello', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }) as typeof fetch;

  try {
    const result = await (
      fetchMarkdownContent as unknown as (
        path: string,
        cfg: { owner: string; repo: string; branch: string; token: string },
        sha: string,
      ) => Promise<{
        path: string;
        sha: string;
        content: string;
        externalKey: string;
      }>
    )(
      'notes/test.md',
      { owner: 'demo', repo: 'vault', branch: 'main', token: 'secret' },
      'sha-123',
    );

    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? '', /\/contents\/notes\/test\.md\?ref=main$/);
    assert.equal(result.sha, 'sha-123');
    assert.equal(result.externalKey, 'github:demo/vault:notes/test.md@sha-123');
    assert.equal(result.content, '# Hello');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('escapes markdown paths with reserved characters for GitHub contents API', async () => {
  const calls: Array<{ url: string; accept: string | null }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      accept: (init?.headers as Record<string, string> | undefined)?.Accept ?? null,
    });

    return new Response('# Hello', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }) as typeof fetch;

  try {
    await (
      fetchMarkdownContent as unknown as (
        path: string,
        cfg: { owner: string; repo: string; branch: string; token: string },
        sha: string,
      ) => Promise<{
        path: string;
        sha: string;
        content: string;
        externalKey: string;
      }>
    )(
      '03-🎨设计产品/UX设计/迷思 #25: 如果有良好的可用性，美感不重要.md',
      { owner: 'demo', repo: 'vault', branch: 'main', token: 'secret' },
      'sha-456',
    );

    assert.match(calls[0]?.url ?? '', /%F0%9F%8E%A8/);
    assert.match(calls[0]?.url ?? '', /%2325/);
    assert.doesNotMatch(calls[0]?.url ?? '', /迷思 #25/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('falls back to contents traversal when recursive tree is truncated', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/branches/main')) {
      return Response.json({ commit: { sha: 'head', commit: { tree: { sha: 'tree-sha' } } } });
    }
    if (url.includes('/git/trees/tree-sha')) {
      return Response.json({ truncated: true, tree: [] });
    }
    if (url.endsWith('/contents?ref=main')) {
      return Response.json([
        { path: 'notes', type: 'dir', sha: 'dir-sha' },
        { path: '.obsidian', type: 'dir', sha: 'obsidian-sha' },
      ]);
    }
    if (url.endsWith('/contents/notes?ref=main')) {
      return Response.json([
        { path: 'notes/a.md', type: 'file', sha: 'sha-a', size: 12 },
        { path: 'notes/image.png', type: 'file', sha: 'sha-img', size: 99 },
      ]);
    }
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;

  try {
    const files = await listMarkdownFiles({
      owner: 'demo',
      repo: 'vault',
      branch: 'main',
      token: 'secret',
    });

    assert.deepEqual(files, [
      {
        path: 'notes/a.md',
        sha: 'sha-a',
        size: 12,
        externalKey: 'github:demo/vault:notes/a.md@sha-a',
      },
    ]);
    assert.ok(calls.some((url) => url.includes('/contents/notes?ref=main')));
    assert.equal(
      calls.some((url) => url.includes('/contents/.obsidian')),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
