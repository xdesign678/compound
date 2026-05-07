import { expect, test } from '@playwright/test';

test('sync dashboard renders operational fields', async ({ page }) => {
  await page.goto('/sync');

  await expect(page.getByText('Compound · 同步控制台')).toBeVisible();
  await expect(page.getByRole('button', { name: '打开高级抽屉' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /同步|尚未运行同步/ })).toBeVisible();
});
