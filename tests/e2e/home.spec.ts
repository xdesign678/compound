import { expect, test } from '@playwright/test';

test('home renders seeded wiki content', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.desktop-brand-kicker')).toHaveText('Compound');
  await expect(page.getByRole('tab', { name: 'Wiki' })).toBeVisible();
  await expect(page.locator('.concept-card').first()).toBeVisible();
});
