import { expect, test, type Page } from '@playwright/test';

async function waitForApp(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '问答' })).toBeVisible({ timeout: 40_000 });
}

async function seedAskHistory(
  page: Page,
  spec: {
    count?: number;
    at?: number;
    sameTimestamp?: boolean;
    extra?: Array<Record<string, unknown>>;
  },
) {
  await page.evaluate(async (options) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['askHistory'], 'readwrite');
      const store = tx.objectStore('askHistory');
      store.clear();
      const count = options.count ?? 0;
      const base = options.at ?? 1_700_000_000_000;
      for (let index = 0; index < count; index += 1) {
        store.put({
          id: `hist-${String(index).padStart(5, '0')}`,
          role: index % 2 === 0 ? 'user' : 'ai',
          text: index % 2 === 0 ? `历史问题 ${index}` : `历史答案 ${index}`,
          at: options.sameTimestamp ? base : base + index,
          citedConcepts: index === count - 1 && index % 2 === 1 ? ['c-seed-1'] : undefined,
        });
      }
      for (const row of options.extra ?? []) {
        store.put(row);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, spec);
}

async function keepLocalIfQuarantined(page: Page) {
  const dismiss = page.getByRole('button', { name: '暂时收起，继续保留本机' });
  await dismiss.click({ timeout: 2_000 }).catch(() => undefined);
}

async function openAsk(page: Page) {
  await page.getByRole('tab', { name: '问答' }).click();
  await expect(page.locator('.ask-view')).toBeVisible();
  await keepLocalIfQuarantined(page);
}

async function messageIds(page: Page) {
  return page
    .locator('.ask-stream .msg[data-ask-message-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ask-message-id') || ''));
}

test('10k ask history first screen renders at most 50 messages', async ({ page }) => {
  test.slow();
  await waitForApp(page);
  await seedAskHistory(page, { count: 10_000 });
  await openAsk(page);

  await expect(page.getByRole('button', { name: '加载更早的对话' })).toBeVisible();
  await expect(page.locator('.ask-stream .msg[data-ask-message-id]')).toHaveCount(50);
  await expect(page.getByText('历史问题 9950')).toBeVisible();
  await expect(page.getByText('历史答案 9999')).toBeVisible();
  await expect(page.getByText('历史问题 0')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '归档为新页面' }).first()).toBeVisible();
});

test('same-timestamp history stays stably ordered by id', async ({ page }) => {
  await waitForApp(page);
  await seedAskHistory(page, {
    count: 0,
    extra: ['hist-z', 'hist-m', 'hist-a', 'hist-k', 'hist-b'].map((id) => ({
      id,
      role: 'user',
      text: id,
      at: 42,
    })),
  });
  await openAsk(page);

  await expect(page.locator('.ask-stream .msg[data-ask-message-id]')).toHaveCount(5);
  expect(await messageIds(page)).toEqual(['hist-a', 'hist-b', 'hist-k', 'hist-m', 'hist-z']);
  await expect(page.getByRole('button', { name: '加载更早的对话' })).toHaveCount(0);
});

test('loading earlier appends one page without duplicates and hides the button at the top', async ({
  page,
}) => {
  test.slow();
  await waitForApp(page);
  await seedAskHistory(page, { count: 70 });
  await openAsk(page);

  await expect(page.locator('.ask-stream .msg[data-ask-message-id]')).toHaveCount(50);
  const firstPage = await messageIds(page);

  await keepLocalIfQuarantined(page);
  await page.getByRole('button', { name: '加载更早的对话' }).click();
  await expect(page.locator('.ask-stream .msg[data-ask-message-id]')).toHaveCount(70);

  const merged = await messageIds(page);
  expect(new Set(merged).size).toBe(70);
  expect(merged.slice(-50)).toEqual(firstPage);
  expect(merged[0]).toBe('hist-00000');
  await expect(page.getByText('历史问题 0')).toBeVisible();
  await expect(page.getByRole('button', { name: '加载更早的对话' })).toHaveCount(0);
});

test('a newly persisted ask message enters the current window', async ({ page }) => {
  test.slow();
  await page.route('**/api/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: delta',
        'data: {"text":"实时新答案"}',
        '',
        'event: done',
        'data: {"citedConceptIds":[],"archivable":false,"suggestedQuestions":[],"stageDurations":{}}',
        '',
      ].join('\n'),
    });
  });
  await waitForApp(page);
  await seedAskHistory(page, { count: 60 });
  await openAsk(page);
  await expect(page.locator('.ask-stream .msg[data-ask-message-id]')).toHaveCount(50);
  const firstVisible = await page
    .locator('.ask-stream .msg[data-ask-message-id]')
    .first()
    .getAttribute('data-ask-message-id');

  await keepLocalIfQuarantined(page);
  await page.getByLabel('输入问题').fill('实时新问题');
  await page.getByLabel('输入问题').press('Enter');

  await expect(page.getByText('实时新问题')).toBeVisible();
  await expect(page.getByText('实时新答案')).toBeVisible();
  const ids = await messageIds(page);
  expect(ids[0]).toBe(firstVisible);
  expect(ids.at(-2)).toBeTruthy();
  expect(ids.length).toBe(52);
});
