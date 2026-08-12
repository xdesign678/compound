import { expect, test } from '@playwright/test';

async function readLocalKnowledgeCounts(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(['sources', 'concepts'], 'readonly');
    const count = (storeName: string) =>
      new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore(storeName).count();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    const [sources, concepts] = await Promise.all([count('sources'), count('concepts')]);
    db.close();
    return { sources, concepts };
  });
}

test('settings drawer switches tabs without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByLabel('设置').click();

  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
  await page.getByRole('tab', { name: '模型' }).click();
  await expect(page.getByText('LLM 配置')).toBeVisible();
  await page.getByRole('tab', { name: '数据' }).click();
  await expect(page.getByText('数据管理')).toBeVisible();

  expect(errors).toEqual([]);
});

test('settings language switch updates migrated navigation copy', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('设置').click();
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();

  await page.getByRole('radio', { name: '英文' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('tab', { name: 'Sources' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Chinese' }).click();
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
});

test('settings traps keyboard focus and restores it to the opener', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const opener = page.getByRole('button', { name: '设置' });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toBeVisible();
  for (let index = 0; index < 12; index += 1) await page.keyboard.press('Tab');
  await expect(dialog.locator(':focus')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('signing out locks private IndexedDB content while keeping the offline cache', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.concept-card').first()).toBeVisible();
  const before = await readLocalKnowledgeCounts(page);
  expect(before.sources + before.concepts).toBeGreaterThan(0);

  await page.getByLabel('设置').click();
  await page.getByRole('tab', { name: '模型' }).click();
  await page.getByRole('button', { name: '退出并保留缓存' }).click();

  await expect(page).toHaveURL(/\/offline$/);
  await expect(page.getByRole('heading', { name: '本地缓存已锁定' })).toBeVisible();
  await expect(page.getByText('已缓存资料')).toHaveCount(0);
  expect(await readLocalKnowledgeCounts(page)).toEqual(before);
});

test('full sign-out requires confirmation and clears only this device knowledge cache', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.concept-card').first()).toBeVisible();
  const before = await readLocalKnowledgeCounts(page);
  expect(before.sources + before.concepts).toBeGreaterThan(0);

  await page.getByLabel('设置').click();
  await page.getByRole('tab', { name: '模型' }).click();
  await page.getByRole('button', { name: '退出并清除此设备缓存' }).click();
  await expect(page.getByText('清除此设备的私有缓存？')).toBeVisible();
  await expect(page.getByText('服务器知识库不会删除。')).toBeVisible();
  await page.getByRole('button', { name: '确认退出并清除' }).click();

  await expect(page).toHaveURL(/\/offline$/);
  await expect(page.getByRole('heading', { name: '本地缓存已锁定' })).toBeVisible();
  await expect.poll(() => readLocalKnowledgeCounts(page)).toEqual({ sources: 0, concepts: 0 });
});
