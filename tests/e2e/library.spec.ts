import { expect, test } from '@playwright/test';

test('library search filters the concept list', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.concept-card').first()).toBeVisible();
  await page.getByLabel('搜索概念').fill('not-a-real-compound-topic-xyz');

  await expect(page.getByText('没有匹配的概念')).toBeVisible();
});
