import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchMarkdownContent } from './github-sync';

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
