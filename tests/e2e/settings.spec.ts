import { expect, test } from '@playwright/test';

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

  await page.getByRole('button', { name: '英文' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Sources' })).toBeVisible();

  await page.getByRole('button', { name: 'Chinese' }).click();
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
});
