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

  const editor = page.getByLabel('资料正文 Markdown 编辑器');
  await expect(editor).toBeVisible();
  const original = await editor.inputValue();
  const next = `${original.trim()}\n\n## E2E Markdown Preview\n\n- saved item`;

  await editor.fill(next);
  await expect(page.locator('.source-editor-preview h2')).toContainText('E2E Markdown Preview');
  await expect(page.locator('.source-editor-preview').getByText('saved item')).toBeVisible();

  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已保存')).toBeVisible();
  expect(savedMarkdown).toContain('E2E Markdown Preview');
});
