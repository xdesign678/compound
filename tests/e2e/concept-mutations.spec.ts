import { expect, test, type Page, type Route } from '@playwright/test';

type ActivityRow = {
  id: string;
  title?: string;
  relatedConceptIds?: string[];
};

async function readActivities(page: Page): Promise<ActivityRow[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const items = await new Promise<ActivityRow[]>((resolve, reject) => {
      const transaction = db.transaction(['activity'], 'readonly');
      const request = transaction.objectStore('activity').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as ActivityRow[]);
    });
    db.close();
    return items;
  });
}

async function readIdbConcepts(page: Page, ids: string[]): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (conceptIds) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await Promise.all(
      conceptIds.map(
        (id) =>
          new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
            const transaction = db.transaction(['concepts'], 'readonly');
            const request = transaction.objectStore('concepts').get(id);
            request.onerror = () => reject(request.error);
            request.onsuccess = () =>
              resolve(request.result as Record<string, unknown> | undefined);
          }),
      ),
    );
    db.close();
    return rows.filter((row): row is Record<string, unknown> => Boolean(row));
  }, ids);
}

async function stubConceptPreflightGet(page: Page, fallbackRevision: number): Promise<void> {
  await page.route(
    (url: URL) => url.pathname === '/api/data/concepts' && url.searchParams.has('ids'),
    async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      const ids =
        new URL(route.request().url()).searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
      const concepts = await readIdbConcepts(page, ids);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          concepts: concepts.map((concept) => ({
            ...concept,
            serverRevision:
              typeof concept.serverRevision === 'number'
                ? concept.serverRevision
                : fallbackRevision,
          })),
        }),
      });
    },
  );
}

async function openFirstConcept(page: Page): Promise<{ id: string; title: string }> {
  await page.goto('/');
  const card = page.locator('.concept-card[data-concept-id]').first();
  await expect(card).toBeVisible({ timeout: 40_000 });
  const id = await card.getAttribute('data-concept-id');
  const title = ((await card.locator('.title').textContent()) ?? '').trim();
  expect(id).toBeTruthy();
  expect(title.length).toBeGreaterThan(0);
  await stubConceptPreflightGet(page, 2);
  await card.click();
  await expect(page.getByRole('button', { name: '标记有误' })).toBeVisible();
  return { id: id!, title };
}

test('flagging a concept reuses the server review and mirrors one activity', async ({ page }) => {
  const opened = await openFirstConcept(page);
  const review = {
    id: 'rv-e2e-1',
    kind: 'concept_incorrect',
    status: 'open',
    title: `标记有误：${opened.title}`,
    target_id: opened.id,
    created_at: 1,
    updated_at: 1,
  };
  const activity = {
    id: 'a-e2e-flag-1',
    type: 'lint',
    title: `标记有误：${opened.title}`,
    details: 'server queue',
    status: 'success',
    relatedConceptIds: [opened.id],
    at: 1,
  };

  let flagPosts = 0;
  const expectedRevisions: number[] = [];
  await page.route('**/api/data/concepts/**/flag', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    flagPosts += 1;
    const payload = route.request().postDataJSON() as { expectedRevision?: number };
    expectedRevisions.push(payload.expectedRevision ?? 0);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        created: flagPosts === 1,
        review,
        activity,
      }),
    });
  });

  await page.getByRole('button', { name: '标记有误' }).click();
  await expect(page.getByText('已标记为有误')).toBeVisible();
  await page.getByRole('button', { name: '标记有误' }).click();
  await expect(page.getByText('已在审核队列中')).toBeVisible();

  expect(flagPosts).toBe(2);
  expect(expectedRevisions.every((revision) => revision >= 1)).toBeTruthy();
  expect(expectedRevisions).toHaveLength(2);

  const mirrored = (await readActivities(page)).filter((item) => item.id === activity.id);
  expect(mirrored).toHaveLength(1);
  expect(mirrored[0]?.relatedConceptIds).toEqual([opened.id]);

  const localFlags = (await readActivities(page)).filter((item) =>
    item.id.startsWith(`flag-${opened.id}-`),
  );
  expect(localFlags).toHaveLength(0);
});

test('successful delete stays gone after refresh and sync', async ({ page }) => {
  const opened = await openFirstConcept(page);

  await page.route('**/api/data/snapshot**', async (route) => {
    try {
      const response = await route.fetch();
      const payload = (await response.json()) as {
        concepts?: Array<{ id: string }>;
        sync?: { deleted?: { concepts?: string[] } };
      };
      if (Array.isArray(payload.concepts)) {
        payload.concepts = payload.concepts.filter((concept) => concept.id !== opened.id);
      }
      payload.sync = payload.sync ?? {};
      payload.sync.deleted = payload.sync.deleted ?? {};
      payload.sync.deleted.concepts = [
        ...new Set([...(payload.sync.deleted.concepts ?? []), opened.id]),
      ];
      await route.fulfill({
        status: response.status(),
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (page.isClosed()) return;
      throw error;
    }
  });

  let deletePosts = 0;
  await page.route(
    (url: URL) => /^\/api\/data\/concepts\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deletePosts += 1;
      const payload = route.request().postDataJSON() as { expectedRevision?: number };
      expect(payload.expectedRevision).toBeGreaterThanOrEqual(1);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ deleted: true, idempotent: false }),
      });
    },
  );

  await page.getByRole('button', { name: '删除概念' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('概念已删除')).toBeVisible();
  await expect(page.locator(`[data-concept-id="${opened.id}"]`)).toHaveCount(0);
  expect(deletePosts).toBe(1);

  await page.reload();
  await expect(page.locator('.concept-card[data-concept-id]').first()).toBeVisible({
    timeout: 40_000,
  });
  await expect(page.locator(`[data-concept-id="${opened.id}"]`)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: opened.title, exact: true })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('stale delete keeps the concept detail', async ({ page }) => {
  const opened = await openFirstConcept(page);

  let deletePosts = 0;
  await page.route(
    (url: URL) => /^\/api\/data\/concepts\/[^/]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deletePosts += 1;
      const payload = route.request().postDataJSON() as { expectedRevision?: number };
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'revision_conflict',
          expectedRevision: payload.expectedRevision ?? 1,
          currentRevision: (payload.expectedRevision ?? 1) + 1,
        }),
      });
    },
  );

  await page.getByRole('button', { name: '删除概念' }).click();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(page.locator('.concept-mutation-error')).toContainText(
    '服务器版本已变化，未删除本地概念',
  );
  await expect(page.getByRole('button', { name: '刷新服务器版本' })).toBeVisible();
  await expect(page.getByRole('heading', { name: opened.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '标记有误' })).toBeVisible();
  expect(deletePosts).toBe(1);
});

test('concept flag preflights the server revision when the local token is missing', async ({
  page,
}) => {
  const opened = await openFirstConcept(page);
  let flagRevision: number | undefined;
  let preflightGets = 0;

  await page.evaluate(async (conceptId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['concepts'], 'readwrite');
      const store = transaction.objectStore('concepts');
      const request = store.get(conceptId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const row = request.result as Record<string, unknown> | undefined;
        if (row) {
          delete row.serverRevision;
          store.put(row);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }, opened.id);

  await page.route(
    (url: URL) => url.pathname === '/api/data/concepts' && url.searchParams.has('ids'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      preflightGets += 1;
      const concepts = await readIdbConcepts(page, [opened.id]);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          concepts: concepts.map((concept) => ({ ...concept, serverRevision: 5 })),
        }),
      });
    },
  );

  await page.route('**/api/data/concepts/**/flag', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as { expectedRevision?: number };
    flagRevision = payload.expectedRevision;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        created: true,
        review: {
          id: 'rv-preflight',
          kind: 'concept_incorrect',
          status: 'open',
          title: `标记有误：${opened.title}`,
          target_id: opened.id,
        },
        activity: {
          id: 'a-preflight',
          type: 'lint',
          title: `标记有误：${opened.title}`,
          details: 'preflight',
          status: 'success',
          relatedConceptIds: [opened.id],
          at: 1,
        },
      }),
    });
  });

  await page.getByRole('button', { name: '标记有误' }).click();
  await expect(page.getByText('已标记为有误')).toBeVisible();
  expect(preflightGets).toBeGreaterThanOrEqual(1);
  expect(flagRevision).toBe(5);
});
