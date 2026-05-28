import { expect, test } from '@playwright/test';

test('sources search filters the source list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();

  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.getByLabel('搜索资料').fill('Memex');

  await expect(page.getByRole('button', { name: /As We May Think/ })).toBeVisible();
  await expect(page.getByText('LLM Wiki — an idea file')).not.toBeVisible();

  await page.getByLabel('搜索资料').fill('not-a-real-compound-source-xyz');
  await expect(page.getByText('没有匹配的资料')).toBeVisible();
});
