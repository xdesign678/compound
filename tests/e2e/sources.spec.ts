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

test('sources first navigation has card styling before opening a detail chunk', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();

  const firstCard = page.locator('.source-card').first();
  await expect(firstCard).toBeVisible();
  const style = await firstCard.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      display: computed.display,
      paddingTop: Number.parseFloat(computed.paddingTop),
      radius: Number.parseFloat(computed.borderTopLeftRadius),
    };
  });
  expect(style.display).toBe('block');
  expect(style.paddingTop).toBeGreaterThan(0);
  expect(style.radius).toBeGreaterThan(0);
});

test('mobile source detail exposes a single visible back header', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();
  await page.locator('.source-card').first().click();

  await expect(page.locator('.mobile-detail-overlay')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回' })).toHaveCount(1);
});
