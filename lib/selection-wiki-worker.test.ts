import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SelectionWikiRequest } from './types';

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

function setupTempDb() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'compound-selection-wiki-'));
  const previousEnv = new Map<string, string | undefined>();
  for (const key of ['DATA_DIR', 'LLM_API_KEY', 'LLM_API_URL', 'COMPOUND_SKIP_DNS_GUARD']) {
    previousEnv.set(key, process.env[key]);
  }
  process.env.DATA_DIR = tempDir;
  process.env.LLM_API_KEY = 'server-key';
  process.env.LLM_API_URL = 'https://api.example.com/v1/chat/completions';
  process.env.COMPOUND_SKIP_DNS_GUARD = 'true';
  closeServerDbGlobal();
  delete (globalThis as Record<string, unknown>).__compoundSelectionWikiWorkers;
  return {
    cleanup() {
      closeServerDbGlobal();
      delete (globalThis as Record<string, unknown>).__compoundSelectionWikiWorkers;
      for (const [key, value] of previousEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function seedSourceConcept(): Promise<void> {
  const { repo } = await import('./server-db');
  const now = Date.now();
  repo.upsertConcept({
    id: 'c-source',
    title: '自由家长主义',
    summary: '关于选择自由与政策设计的概念。',
    body: '自由家长主义讨论如何在不限制选择的前提下设计默认选项。',
    sources: [],
    related: [],
    categories: [],
    categoryKeys: [],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}

async function waitForSelectionRunDone(runId: string, timeoutMs = 10_000): Promise<void> {
  const { getSelectionWikiRunStatus } = await import('./selection-wiki-worker');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = getSelectionWikiRunStatus(runId);
    if (status && status.status !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`selection wiki run ${runId} did not finish within ${timeoutMs}ms`);
}

const request: SelectionWikiRequest = {
  selection: '卡斯·桑斯坦与塞勒共同提出自由家长主义。',
  sourceConceptId: 'c-source',
  contextTitle: '自由家长主义',
};

function selectionWikiResponse() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              isDuplicate: false,
              concept: {
                title: '选择架构',
                summary: '通过默认项和呈现方式影响选择，同时保留个人自由。',
                body: '选择架构关注选项如何被组织、呈现和默认化。',
                relatedConceptIds: ['c-source'],
                categories: [{ primary: '行为经济学', secondary: '政策设计' }],
              },
              activitySummary: '从选段生成选择架构概念。',
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

test(
  'selection wiki worker persists a server-side run and mirrors the created concept in status',
  {
    concurrency: false,
  },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    await seedSourceConcept();

    let sawRequest = false;
    const mockFetch: typeof fetch = async (input, init) => {
      sawRequest = true;
      assert.equal(String(input), 'https://llm.example.com/v1/chat/completions');
      const headers = new Headers(init?.headers as HeadersInit);
      assert.equal(headers.get('authorization'), 'Bearer user-key');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, 'user-model');
      return selectionWikiResponse();
    };

    await withMockFetch(mockFetch, async () => {
      const { createSelectionWikiRun, getSelectionWikiRunStatus, startSelectionWikiWorker } =
        await import('./selection-wiki-worker');
      const runId = createSelectionWikiRun(request);
      startSelectionWikiWorker(runId, {
        apiKey: 'user-key',
        apiUrl: 'https://llm.example.com/v1/chat/completions',
        model: 'user-model',
      });
      await waitForSelectionRunDone(runId);

      const status = getSelectionWikiRunStatus(runId);
      assert.equal(status?.status, 'done');
      assert.equal(status?.phase, 'done');
      assert.equal(status?.result?.status, 'created');
      assert.equal(
        status?.result?.concepts.some((concept) => concept.title === '选择架构'),
        true,
      );

      const { repo } = await import('./server-db');
      const source = repo.getConcept('c-source');
      assert.equal(
        source?.related.some((conceptId) => conceptId === status?.result?.conceptId),
        true,
      );
    });

    assert.equal(sawRequest, true);
  },
);

test(
  'selection wiki worker can resume a running run after the page disappears',
  {
    concurrency: false,
  },
  async (t) => {
    const env = setupTempDb();
    t.after(env.cleanup);
    await seedSourceConcept();

    const mockFetch: typeof fetch = async () => selectionWikiResponse();

    await withMockFetch(mockFetch, async () => {
      const { createSelectionWikiRun, getSelectionWikiRunStatus, resumePendingSelectionWikiRuns } =
        await import('./selection-wiki-worker');
      const runId = createSelectionWikiRun(request);

      delete (globalThis as Record<string, unknown>).__compoundSelectionWikiWorkers;
      resumePendingSelectionWikiRuns();
      await waitForSelectionRunDone(runId);

      const status = getSelectionWikiRunStatus(runId);
      assert.equal(status?.status, 'done');
      assert.equal(status?.result?.status, 'created');
    });
  },
);
