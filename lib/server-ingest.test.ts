import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function closeServerDbGlobal() {
  const holder = (globalThis as Record<string, unknown>).__compound_sqlite__ as
    | { db?: { close?: () => void } }
    | undefined;
  holder?.db?.close?.();
  delete (globalThis as Record<string, unknown>).__compound_sqlite__;
}

async function withMockFetch<T>(mockFetch: typeof fetch, fn: () => Promise<T> | T): Promise<T> {
  const previous = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = previous;
  }
}

test(
  'ingestSourceToServerDb returns persisted records for client sync',
  { concurrency: false },
  async (t) => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-server-ingest-'));
    const previousEnv = new Map<string, string | undefined>();
    for (const key of ['DATA_DIR', 'LLM_API_KEY', 'LLM_API_URL', 'COMPOUND_SKIP_DNS_GUARD']) {
      previousEnv.set(key, process.env[key]);
    }

    process.env.DATA_DIR = tempDir;
    process.env.LLM_API_KEY = 'server-key';
    process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
    process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
    closeServerDbGlobal();

    t.after(() => {
      closeServerDbGlobal();
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  newConcepts: [
                    {
                      title: 'Alpha',
                      summary: 'Alpha summary',
                      body: 'Alpha body',
                      relatedConceptIds: [],
                    },
                  ],
                  updatedConcepts: [],
                  activitySummary: 'created Alpha',
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    await withMockFetch(mockFetch, async () => {
      const { ingestSourceToServerDb } = await import('./server-ingest');
      const result = await ingestSourceToServerDb({
        title: 'Alpha Notes',
        type: 'text',
        rawContent: 'Alpha raw notes',
      });

      const syncResult = result as unknown as {
        source?: { id: string; title: string; rawContent: string };
        concepts?: Array<{ id: string; title: string; body: string }>;
        activity?: { id: string; details: string };
      };

      assert.equal(syncResult.source?.id, result.sourceId);
      assert.equal(syncResult.source?.rawContent, 'Alpha raw notes');
      assert.equal(syncResult.concepts?.[0]?.id, result.newConceptIds[0]);
      assert.equal(syncResult.concepts?.[0]?.body, 'Alpha body');
      assert.equal(syncResult.activity?.id, result.activityId);
    });
  },
);
