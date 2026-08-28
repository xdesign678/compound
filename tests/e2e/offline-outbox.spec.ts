import { expect, test } from '@playwright/test';

async function readOutboxPayloads(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    if (!db.objectStoreNames.contains('offlineOutbox')) {
      db.close();
      return [];
    }
    const rows = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const tx = db.transaction(['offlineOutbox'], 'readonly');
      const request = tx.objectStore('offlineOutbox').getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
    });
    db.close();
    return rows;
  });
}

test('offline ingest queues once, survives refresh, and replays a single server result', async ({
  page,
}) => {
  test.slow();
  let ingestCalls = 0;
  let ingestOnline = false;

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => window.sessionStorage.getItem('compound:e2e-offline') !== '1',
    });
  });

  await page.route('**/api/ingest', async (route) => {
    if (!ingestOnline) {
      await route.abort('internetdisconnected');
      return;
    }
    ingestCalls += 1;
    const now = Date.now();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sourceId: 's-outbox-1',
        newConceptIds: ['c-outbox-1'],
        updatedConceptIds: [],
        activityId: 'a-outbox-1',
        source: {
          id: 's-outbox-1',
          title: '离线笔记',
          type: 'text',
          rawContent: '离线正文',
          ingestedAt: now,
        },
        concepts: [
          {
            id: 'c-outbox-1',
            title: '离线概念',
            summary: '摘要',
            body: '正文',
            sources: ['s-outbox-1'],
            related: [],
            createdAt: now,
            updatedAt: now,
            version: 1,
            categories: [],
            categoryKeys: [],
          },
        ],
        activity: {
          id: 'a-outbox-1',
          type: 'ingest',
          title: '离线笔记',
          details: 'queued',
          at: now,
        },
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.concept-card').first()).toBeVisible({ timeout: 40_000 });

  await page.getByRole('button', { name: '添加新资料' }).click();
  await expect(page.getByRole('button', { name: /新建笔记/ })).toBeVisible();

  await page.evaluate(() => {
    window.sessionStorage.setItem('compound:e2e-offline', '1');
    window.dispatchEvent(new Event('offline'));
  });

  await page.getByRole('button', { name: /新建笔记/ }).click();
  await page.locator('.note-editor-title').fill('离线笔记');
  await page.locator('.note-editor-textarea').fill('离线正文，刷新后仍应保留。');
  await page.getByRole('button', { name: '完成' }).click();

  await expect(page.getByRole('heading', { name: '添加新资料' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.locator('.note-editor-overlay')).toHaveCount(0);

  const queued = await readOutboxPayloads(page);
  expect(queued.length).toBe(1);
  const payload = queued[0].payload as { rawContent?: string; apiKey?: string };
  expect(payload.rawContent).toContain('离线正文');
  expect(payload.apiKey).toBeUndefined();
  expect(JSON.stringify(queued[0])).not.toMatch(/sk-|apiKey":"/);
  expect(ingestCalls).toBe(0);

  await page.reload();
  await expect(page.locator('.desktop-brand-kicker, .header')).toBeVisible({ timeout: 40_000 });
  const afterReload = await readOutboxPayloads(page);
  expect(afterReload.length).toBe(1);
  expect((afterReload[0].payload as { rawContent?: string }).rawContent).toContain('离线正文');
  expect(ingestCalls).toBe(0);

  ingestOnline = true;
  await page.evaluate(() => {
    window.sessionStorage.removeItem('compound:e2e-offline');
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => ingestCalls, { timeout: 20_000 }).toBe(1);

  const taskTrigger = page.getByRole('button', { name: /任务中心|个任务/ });
  await expect(taskTrigger).toBeVisible({ timeout: 10_000 });
  await taskTrigger.click();
  await expect(page.locator('.tc-badge-success').first()).toBeVisible();
  await expect(page.getByText('离线笔记')).toBeVisible();

  await page.reload();
  await expect(page.locator('.desktop-brand-kicker, .header')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /任务中心|个任务/ }).click();
  await expect(page.locator('.tc-badge-success').first()).toBeVisible();
  await expect.poll(() => ingestCalls, { timeout: 5_000 }).toBe(1);

  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.sessionStorage.setItem('compound:e2e-offline', '1');
    window.dispatchEvent(new Event('offline'));
  });
  ingestOnline = false;
  await page.getByRole('button', { name: '添加新资料' }).click();
  await page.getByRole('button', { name: /新建笔记/ }).click();
  await page.locator('.note-editor-title').fill('仍在排队');
  await page.locator('.note-editor-textarea').fill('清完终态后应保留。');
  await page.getByRole('button', { name: '完成' }).click();

  await page.getByRole('button', { name: /任务中心|个任务/ }).click();
  await expect(page.getByText('离线笔记')).toBeVisible();
  await expect(page.getByText('仍在排队')).toBeVisible();
  await page.getByRole('button', { name: '清除已完成' }).click();
  await expect(page.getByText('离线笔记')).toHaveCount(0);
  await expect(page.getByText('仍在排队')).toBeVisible();

  await page.reload();
  await expect(page.locator('.desktop-brand-kicker, .header')).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: /任务中心|个任务/ }).click();
  await expect(page.getByText('离线笔记')).toHaveCount(0);
  await expect(page.getByText('仍在排队')).toBeVisible();
});

test('cancelling an inflight ingest ignores a late server response', async ({ page }) => {
  test.slow();
  let ingestCalls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route('**/api/ingest', async (route) => {
    ingestCalls += 1;
    await gate;
    const now = Date.now();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sourceId: 's-late',
        newConceptIds: [],
        updatedConceptIds: [],
        activityId: 'a-late',
        source: {
          id: 's-late',
          title: '晚到',
          type: 'text',
          rawContent: 'x',
          ingestedAt: now,
        },
        concepts: [],
        activity: { id: 'a-late', type: 'ingest', title: '晚到', details: 'late', at: now },
      }),
    });
  });

  await page.goto('/');
  await expect(page.locator('.concept-card').first()).toBeVisible({ timeout: 40_000 });
  await page.getByRole('button', { name: '添加新资料' }).click();
  await page.getByRole('button', { name: /新建笔记/ }).click();
  await page.locator('.note-editor-title').fill('晚到响应');
  await page.locator('.note-editor-textarea').fill('会被取消');
  await page.getByRole('button', { name: '完成' }).click();

  // Prove the request is genuinely inflight before exercising the late-response fence.
  await expect.poll(() => ingestCalls, { timeout: 20_000 }).toBe(1);
  await page.getByRole('button', { name: /任务中心|个任务/ }).click();
  await expect(page.getByText('晚到响应')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  release?.();
  await expect(page.getByText('晚到响应')).toHaveCount(0);
  await expect(page.locator('.tc-badge-success')).toHaveCount(0);
});
