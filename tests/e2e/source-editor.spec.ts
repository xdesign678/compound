import { expect, test } from '@playwright/test';

test('source editor saves markdown and renders live preview', async ({ page }) => {
  let savedMarkdown = '';
  await page.route('**/api/data/sources', async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    const payload = route.request().postDataJSON() as {
      id: string;
      title?: string;
      rawContent: string;
    };
    savedMarkdown = payload.rawContent;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        source: {
          id: payload.id,
          title: payload.title || 'E2E source',
          type: 'article',
          rawContent: payload.rawContent,
          ingestedAt: Date.now(),
          contentStatus: 'full',
        },
        concepts: [],
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: '资料' }).click();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await page.locator('.source-card').first().click();

  const firstBlock = page.getByRole('group', { name: '内容块' }).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.click();
  const editor = page.getByLabel('编辑内容块');
  await expect(editor).toBeVisible();
  const next = '## E2E Markdown Preview\n\n- saved item';

  await editor.fill(next);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'E2E Markdown Preview' })).toBeVisible();
  await expect(page.getByText('saved item')).toBeVisible();

  await expect(page.getByText('已保存')).toBeVisible();
  await expect.poll(() => savedMarkdown).toContain('E2E Markdown Preview');
});
