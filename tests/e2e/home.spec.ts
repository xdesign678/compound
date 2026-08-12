import { expect, test } from '@playwright/test';

test('home renders seeded wiki content', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.desktop-brand-kicker')).toHaveText('Compound');
  await expect(page.getByRole('tab', { name: 'Wiki' })).toBeVisible();
  await expect(page.locator('.concept-card').first()).toBeVisible();
});

test('failed cloud pull does not seed an empty local library', async ({ page }) => {
  await page.route('**/api/data/snapshot**', async (route) => {
    await route.fulfill({ status: 503, body: 'temporarily unavailable' });
  });

  await page.goto('/');
  await expect(page.locator('.desktop-brand-meta')).toHaveText('0 个概念 · 0 份资料', {
    timeout: 15_000,
  });

  const localState = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(['sources', 'concepts', 'activity'], 'readonly');
    const count = (storeName: string) =>
      new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore(storeName).count();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    const [sources, concepts, activity] = await Promise.all([
      count('sources'),
      count('concepts'),
      count('activity'),
    ]);
    db.close();
    return {
      sources,
      concepts,
      activity,
      seeded: localStorage.getItem('compound_seeded'),
      sample: localStorage.getItem('compound_is_sample'),
    };
  });

  expect(localState).toEqual({
    sources: 0,
    concepts: 0,
    activity: 0,
    seeded: null,
    sample: null,
  });
});
