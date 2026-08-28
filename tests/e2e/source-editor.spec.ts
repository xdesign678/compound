import { expect, test, type Page, type Route } from '@playwright/test';

async function readIdbSources(page: Page, ids: string[]): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (sourceIds) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const rows = await Promise.all(
      sourceIds.map(
        (id) =>
          new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
            const transaction = db.transaction(['sources'], 'readonly');
            const request = transaction.objectStore('sources').get(id);
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

async function fulfillSourceGetFromDexie(
  page: Page,
  route: Route,
  fallbackRevision: number,
): Promise<void> {
  const url = new URL(route.request().url());
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
  const sources = await readIdbSources(page, ids);
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sources: sources.map((source) => ({
        ...source,
        serverRevision:
          typeof source.serverRevision === 'number' ? source.serverRevision : fallbackRevision,
      })),
    }),
  });
}

test('source editor saves markdown and renders live preview', async ({ page }) => {
  let savedMarkdown = '';
  let savedExpectedRevision: number | undefined;
  await page.route('**/api/data/sources**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillSourceGetFromDexie(page, route, 3);
      return;
    }
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as {
      id: string;
      title?: string;
      rawContent: string;
      expectedRevision?: number;
    };
    savedMarkdown = payload.rawContent;
    savedExpectedRevision = payload.expectedRevision;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: {
          id: payload.id,
          title: payload.title || 'E2E source',
          type: 'article',
          rawContent: payload.rawContent,
          ingestedAt: Date.now(),
          contentStatus: 'full',
          serverRevision: (payload.expectedRevision ?? 1) + 1,
        },
        concepts: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.locator('.source-card').first().click();

  const firstBlock = page.getByRole('group', { name: '内容块' }).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.click();
  const editor = page.getByLabel('编辑内容块');
  await expect(editor).toBeVisible();
  const next = '## E2E Markdown Preview\n\n- saved item';

  await editor.fill(next);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'E2E Markdown Preview' })).toBeVisible();
  await expect(page.getByText('saved item')).toBeVisible();

  await expect(page.getByText('已保存')).toBeVisible();
  await expect.poll(() => savedMarkdown).toContain('E2E Markdown Preview');
  await expect.poll(() => savedExpectedRevision ?? 0).toBeGreaterThanOrEqual(1);
});

test('source editor keeps local draft on revision conflict and offers copy or reload', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  let sourceId = '';
  let serveReloadedSource = false;
  const localDraft = '## E2E Conflict Draft\n\nkeep these local bytes';
  const serverContent = '## Server Reloaded\n\nfrom the other client';

  await page.route('**/api/data/sources**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      const payload = route.request().postDataJSON() as {
        id: string;
        title?: string;
        rawContent: string;
        expectedRevision?: number;
      };
      sourceId = payload.id;
      expect(payload.expectedRevision).toBeGreaterThanOrEqual(1);
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'revision_conflict',
          expectedRevision: payload.expectedRevision,
          currentRevision: (payload.expectedRevision ?? 1) + 1,
        }),
      });
      return;
    }
    if (method === 'GET') {
      if (serveReloadedSource) {
        const url = new URL(route.request().url());
        const id = url.searchParams.get('ids')?.split(',')[0] || sourceId;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sources: [
              {
                id,
                title: 'E2E source',
                type: 'article',
                rawContent: serverContent,
                ingestedAt: Date.now(),
                contentStatus: 'full',
                serverRevision: 9,
              },
            ],
          }),
        });
        return;
      }
      await fulfillSourceGetFromDexie(page, route, 3);
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.locator('.source-card').first().click();

  const firstBlock = page.getByRole('group', { name: '内容块' }).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.click();
  const editor = page.getByLabel('编辑内容块');
  await expect(editor).toBeVisible();
  await editor.fill(localDraft);
  await page.keyboard.press('Escape');

  await expect(page.getByRole('heading', { name: 'E2E Conflict Draft' })).toBeVisible();
  await expect(page.getByText('keep these local bytes')).toBeVisible();
  await expect(page.getByText('版本冲突，本地草稿未覆盖')).toBeVisible();
  await expect(page.getByText('已保存')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '强制覆盖' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '覆盖服务器' })).toHaveCount(0);

  await expect
    .poll(async () =>
      page.evaluate((id) => window.localStorage.getItem(`compound:source-draft:${id}`), sourceId),
    )
    .toContain('keep these local bytes');

  await page.getByRole('button', { name: '复制本地草稿' }).click();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('keep these local bytes');
  await expect(page.getByRole('heading', { name: 'E2E Conflict Draft' })).toBeVisible();

  serveReloadedSource = true;
  await page.getByRole('button', { name: '重载服务器版本' }).click();
  await expect(page.getByRole('heading', { name: 'Server Reloaded' })).toBeVisible();
  await expect(page.getByText('from the other client')).toBeVisible();
  await expect(page.getByText('E2E Conflict Draft')).toHaveCount(0);
  await expect(page.getByText('版本冲突，本地草稿未覆盖')).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate((id) => window.localStorage.getItem(`compound:source-draft:${id}`), sourceId),
    )
    .toBeNull();
});

test('queued source saves send n then n+1 and keep the later draft', async ({ page }) => {
  const patchRevisions: number[] = [];
  const patchBodies: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  await page.route('**/api/data/sources**', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillSourceGetFromDexie(page, route, 3);
      return;
    }
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as {
      id: string;
      rawContent: string;
      expectedRevision?: number;
    };
    patchRevisions.push(payload.expectedRevision ?? 0);
    patchBodies.push(payload.rawContent);
    if (patchRevisions.length === 1) {
      await firstHeld;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: {
          id: payload.id,
          title: 'E2E source',
          type: 'article',
          rawContent: payload.rawContent,
          ingestedAt: Date.now(),
          contentStatus: 'full',
          serverRevision: (payload.expectedRevision ?? 0) + 1,
        },
        concepts: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.locator('.source-card').first().click();

  const firstBlock = page.getByRole('group', { name: '内容块' }).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.click();
  const editor = page.getByLabel('编辑内容块');
  await expect(editor).toBeVisible();
  await editor.fill('## Queued Save One\n\nfirst in-flight');
  await page.keyboard.press('Escape');
  await expect.poll(() => patchRevisions.length).toBe(1);

  await firstBlock.click();
  await expect(editor).toBeVisible();
  await editor.fill('## Queued Save Two\n\nsecond queued');
  await page.keyboard.press('Escape');
  releaseFirst?.();

  await expect.poll(() => patchRevisions.length).toBe(2);
  expect(patchRevisions[0]).toBeGreaterThanOrEqual(1);
  expect(patchRevisions[1]).toBe(patchRevisions[0]! + 1);
  expect(patchBodies[1]).toContain('second queued');
  await expect(page.getByRole('heading', { name: 'Queued Save Two' })).toBeVisible();
  await expect(page.getByText('second queued')).toBeVisible();
  await expect(page.getByText('版本冲突，本地草稿未覆盖')).toHaveCount(0);
  await expect(page.getByText('已保存')).toBeVisible();
});

test('missing local source revision preflights server token without overwriting the draft', async ({
  page,
}) => {
  let sourceId = '';
  let patchRevision: number | undefined;
  let servePreflight = false;
  const serverBody = '## Server Should Not Appear\n\npreflight body';
  const localDraft = '## Local Missing Token Draft\n\nkeep local bytes';

  await page.route('**/api/data/snapshot**', async (route) => {
    try {
      const response = await route.fetch();
      const payload = (await response.json()) as { sources?: Array<Record<string, unknown>> };
      if (Array.isArray(payload.sources)) {
        payload.sources = payload.sources.map((source) => {
          const next = { ...source };
          delete next.serverRevision;
          return next;
        });
      }
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

  await page.route('**/api/data/sources**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      if (!servePreflight) {
        await route.continue();
        return;
      }
      const url = new URL(route.request().url());
      const id = url.searchParams.get('ids')?.split(',')[0] || sourceId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sources: [
            {
              id,
              title: 'E2E source',
              type: 'article',
              rawContent: serverBody,
              ingestedAt: Date.now(),
              contentStatus: 'full',
              serverRevision: 7,
            },
          ],
        }),
      });
      return;
    }
    if (method === 'PATCH') {
      const payload = route.request().postDataJSON() as {
        id: string;
        title?: string;
        rawContent: string;
        expectedRevision?: number;
      };
      sourceId = payload.id;
      patchRevision = payload.expectedRevision;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source: {
            id: payload.id,
            title: payload.title || 'E2E source',
            type: 'article',
            rawContent: payload.rawContent,
            ingestedAt: Date.now(),
            contentStatus: 'full',
            serverRevision: (payload.expectedRevision ?? 0) + 1,
          },
          concepts: [],
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.locator('.source-card').first().click();

  const firstBlock = page.getByRole('group', { name: '内容块' }).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.click();
  const editor = page.getByLabel('编辑内容块');
  await expect(editor).toBeVisible();
  await editor.fill(localDraft);
  servePreflight = true;
  await page.keyboard.press('Escape');

  await expect(page.getByRole('heading', { name: 'Local Missing Token Draft' })).toBeVisible();
  await expect(page.getByText('keep local bytes')).toBeVisible();
  await expect(page.getByText('Server Should Not Appear')).toHaveCount(0);
  await expect.poll(() => patchRevision ?? 0).toBe(7);
  await expect(page.getByText('已保存')).toBeVisible();
  await expect(page.getByText('版本冲突，本地草稿未覆盖')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
