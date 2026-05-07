import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

async function waitForStableSurface(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

async function expectNoBlockingA11yViolations(page: Page) {
  await waitForStableSurface(page);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = result.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ''),
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

test('a11y audit passes for home', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.concept-card').first()).toBeVisible();

  await expectNoBlockingA11yViolations(page);
});

test('a11y audit passes for library search', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('搜索概念')).toBeVisible();

  await expectNoBlockingA11yViolations(page);
});

test('a11y audit passes for ask', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: '问答' }).click();
  await expect(page.getByLabel('输入问题')).toBeVisible();

  await expectNoBlockingA11yViolations(page);
});

test('a11y audit passes for settings', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('设置').click();
  await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();

  await expectNoBlockingA11yViolations(page);
});
