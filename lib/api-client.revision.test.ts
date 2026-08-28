import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptSavedSourceRevision,
  deleteConcept,
  fetchConceptById,
  fetchSourceById,
  flagConceptIncorrect,
  isRevisionConflictError,
  MissingExpectedRevisionError,
  readExpectedRevision,
  requireExpectedRevision,
  RevisionConflictError,
  updateSourceContent,
} from './api-client';

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function withBrowserFetch(handler: FetchHandler, run: () => Promise<void>): Promise<void> {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousFetch = globalThis.fetch;
  const localStorage = new MemoryStorage();
  localStorage.setItem('compound:offline-access', '1');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      location: { origin: 'https://compound.example' },
    },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.fetch = handler as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    if (previousNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
    } else {
      delete (globalThis as { navigator?: unknown }).navigator;
    }
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('readExpectedRevision does not invent a CAS token', () => {
  assert.equal(readExpectedRevision(4), 4);
  assert.equal(readExpectedRevision(undefined), undefined);
  assert.equal(readExpectedRevision(0), undefined);
  assert.equal(readExpectedRevision(-2), undefined);
  assert.equal(readExpectedRevision(1.5), undefined);
  assert.equal(readExpectedRevision('7'), undefined);
});

test('queued saves adopt the response revision before the next token is sent', () => {
  const first = adoptSavedSourceRevision({ serverRevision: 3 });
  assert.equal(first, 3);
  const second = adoptSavedSourceRevision({ serverRevision: first + 1 });
  assert.equal(second, 4);
  assert.throws(() => adoptSavedSourceRevision({}), MissingExpectedRevisionError);
});

test('updateSourceContent refuses to send a guessed expectedRevision', async () => {
  let called = false;
  await withBrowserFetch(
    async () => {
      called = true;
      return jsonResponse(200, { source: { id: 's-1' } });
    },
    async () => {
      await assert.rejects(
        () =>
          updateSourceContent({
            id: 's-1',
            rawContent: 'draft',
            expectedRevision: 0,
          }),
        MissingExpectedRevisionError,
      );
      assert.throws(() => requireExpectedRevision(undefined), MissingExpectedRevisionError);
      assert.equal(called, false);
    },
  );
});

test('updateSourceContent sends expectedRevision and keeps a stable 409 typed', async () => {
  let capturedBody: unknown;
  await withBrowserFetch(
    async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as unknown;
      return jsonResponse(409, {
        code: 'revision_conflict',
        expectedRevision: 3,
        currentRevision: 5,
      });
    },
    async () => {
      const error = await updateSourceContent({
        id: 's-1',
        rawContent: 'local draft',
        expectedRevision: 3,
      }).catch((caught) => caught);

      assert.equal(isRevisionConflictError(error), true);
      assert.ok(error instanceof RevisionConflictError);
      assert.equal(error.name, 'RevisionConflictError');
      assert.equal(error.message, 'revision_conflict');
      assert.equal(error.expectedRevision, 3);
      assert.equal(error.currentRevision, 5);
      assert.equal(error.status, 409);
      assert.deepEqual(capturedBody, {
        id: 's-1',
        rawContent: 'local draft',
        expectedRevision: 3,
      });
    },
  );
});

test('unstable 409 stays a generic error instead of a typed revision conflict', async () => {
  await withBrowserFetch(
    async () => jsonResponse(409, { error: 'ingest_operation_conflict' }),
    async () => {
      const error = await updateSourceContent({
        id: 's-1',
        rawContent: 'local draft',
        expectedRevision: 1,
      }).catch((caught) => caught);

      assert.equal(isRevisionConflictError(error), false);
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'Error');
      assert.match(error.message, /ingest_operation_conflict/);
    },
  );
});

test('flagConceptIncorrect sends expectedRevision and types a stable 409', async () => {
  let capturedUrl = '';
  let capturedBody: unknown;
  await withBrowserFetch(
    async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as unknown;
      assert.equal(init?.method, 'POST');
      return jsonResponse(409, {
        code: 'revision_conflict',
        expectedRevision: 2,
        currentRevision: 4,
      });
    },
    async () => {
      const error = await flagConceptIncorrect({ id: 'c-1', expectedRevision: 2 }).catch(
        (caught) => caught,
      );
      assert.ok(error instanceof RevisionConflictError);
      assert.equal(error.expectedRevision, 2);
      assert.equal(error.currentRevision, 4);
      assert.match(capturedUrl, /\/api\/data\/concepts\/c-1\/flag$/);
      assert.deepEqual(capturedBody, { expectedRevision: 2 });
    },
  );
});

test('flagConceptIncorrect returns the server review/activity payload on 2xx', async () => {
  const payload = {
    created: false,
    review: {
      id: 'rv-1',
      kind: 'concept_incorrect',
      status: 'open',
      title: '标记有误：Wiki',
      target_id: 'c-1',
      created_at: 1,
      updated_at: 1,
    },
    activity: {
      id: 'a-flag-1',
      type: 'lint',
      title: '标记有误：Wiki',
      details: 'queued',
      status: 'success',
      relatedConceptIds: ['c-1'],
      at: 1,
    },
  };
  await withBrowserFetch(
    async () => jsonResponse(200, payload),
    async () => {
      const result = await flagConceptIncorrect({ id: 'c-1', expectedRevision: 1 });
      assert.deepEqual(result, payload);
    },
  );
});

test('deleteConcept sends expectedRevision and types a stable 409', async () => {
  let capturedUrl = '';
  let capturedBody: unknown;
  await withBrowserFetch(
    async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? '{}')) as unknown;
      assert.equal(init?.method, 'DELETE');
      return jsonResponse(409, {
        code: 'revision_conflict',
        expectedRevision: 1,
        currentRevision: 8,
      });
    },
    async () => {
      const error = await deleteConcept({ id: 'c-del', expectedRevision: 1 }).catch(
        (caught) => caught,
      );
      assert.ok(error instanceof RevisionConflictError);
      assert.equal(error.currentRevision, 8);
      assert.match(capturedUrl, /\/api\/data\/concepts\/c-del$/);
      assert.deepEqual(capturedBody, { expectedRevision: 1 });
    },
  );
});

test('deleteConcept returns the 2xx payload without flattening', async () => {
  await withBrowserFetch(
    async () => jsonResponse(200, { deleted: true, idempotent: false }),
    async () => {
      const result = await deleteConcept({ id: 'c-del', expectedRevision: 1 });
      assert.deepEqual(result, { deleted: true, idempotent: false });
    },
  );
});

test('fetchConceptById reads the requested concept document', async () => {
  const concept = {
    id: 'c-1',
    title: 'Wiki',
    summary: 's',
    body: 'b',
    sources: [],
    related: [],
    createdAt: 1,
    updatedAt: 1,
    version: 1,
    categories: [],
    categoryKeys: [],
    serverRevision: 5,
  };
  await withBrowserFetch(
    async (input) => {
      assert.match(String(input), /\/api\/data\/concepts\?ids=c-1$/);
      return jsonResponse(200, { concepts: [concept] });
    },
    async () => {
      const result = await fetchConceptById('c-1');
      assert.deepEqual(result, concept);
    },
  );
});

test('fetchSourceById reads the requested source document', async () => {
  const source = {
    id: 's-1',
    title: 'Server source',
    type: 'article',
    rawContent: '## Server Reloaded',
    ingestedAt: 1,
    serverRevision: 9,
  };
  await withBrowserFetch(
    async (input) => {
      assert.match(String(input), /\/api\/data\/sources\?ids=s-1$/);
      return jsonResponse(200, { sources: [source] });
    },
    async () => {
      const result = await fetchSourceById('s-1');
      assert.deepEqual(result, source);
    },
  );
});
