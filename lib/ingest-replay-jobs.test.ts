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

test(
  'same operationId replay does not requeue enhancement jobs or leak replayed in the public result',
  { concurrency: false },
  async (t) => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-ingest-replay-jobs-'));
    const previous = {
      DATA_DIR: process.env.DATA_DIR,
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_API_URL: process.env.LLM_API_URL,
      COMPOUND_SKIP_DNS_GUARD: process.env.COMPOUND_SKIP_DNS_GUARD,
      COMPOUND_DISABLE_CATEGORY_WIKI_AUTO_WORKERS:
        process.env.COMPOUND_DISABLE_CATEGORY_WIKI_AUTO_WORKERS,
    };
    process.env.DATA_DIR = tempDir;
    process.env.LLM_API_KEY = 'server-key';
    process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
    process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
    process.env.COMPOUND_DISABLE_CATEGORY_WIKI_AUTO_WORKERS = 'true';
    closeServerDbGlobal();
    t.after(() => {
      closeServerDbGlobal();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    const previousFetch = global.fetch;
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  newConcepts: [
                    {
                      title: 'Replay',
                      summary: 's',
                      body: 'b',
                      relatedConceptIds: [],
                      categories: [],
                    },
                  ],
                  updatedConcepts: [],
                  activitySummary: 'created',
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    try {
      const { ingestSourceToServerDbDetailed } = await import('./server-ingest');
      const { queueSourceEnhancementJobs } = await import('./analysis-worker');
      const { getServerDb } = await import('./server-db');
      const first = await ingestSourceToServerDbDetailed({
        title: 'Replay Notes',
        type: 'text',
        rawContent: 'body',
        operationId: 'op-replay-jobs0001',
      });
      assert.equal(first.replayed, false);
      queueSourceEnhancementJobs({
        sourceId: first.result.sourceId,
        sourcePath: first.result.source.title,
      });
      const db = getServerDb();
      const before = db
        .prepare(`SELECT id, status FROM analysis_jobs WHERE source_id = ?`)
        .all(first.result.sourceId) as Array<{ id: string; status: string }>;
      assert.ok(before.length > 0);
      db.prepare(`UPDATE analysis_jobs SET status = 'succeeded' WHERE source_id = ?`).run(
        first.result.sourceId,
      );

      const second = await ingestSourceToServerDbDetailed({
        title: 'Replay Notes',
        type: 'text',
        rawContent: 'body',
        operationId: 'op-replay-jobs0001',
      });
      assert.equal(second.replayed, true);
      assert.equal(second.result.sourceId, first.result.sourceId);
      assert.equal('replayed' in second.result, false);

      if (!second.replayed) {
        queueSourceEnhancementJobs({
          sourceId: second.result.sourceId,
          sourcePath: second.result.source.title,
        });
      }

      const after = db
        .prepare(`SELECT id, status FROM analysis_jobs WHERE source_id = ?`)
        .all(first.result.sourceId) as Array<{ id: string; status: string }>;
      assert.deepEqual(
        after.map((row) => row.status),
        before.map(() => 'succeeded'),
      );
      assert.equal(JSON.stringify(second.result).includes('"replayed"'), false);
    } finally {
      global.fetch = previousFetch;
    }
  },
);
