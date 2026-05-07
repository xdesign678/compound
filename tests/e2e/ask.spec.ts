import { expect, test } from '@playwright/test';

test('ask streams stage events and an answer with mocked query SSE', async ({ page }) => {
  await page.route('**/api/query', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: stage',
        'data: {"key":"rewrite","status":"start"}',
        '',
        'event: stage',
        'data: {"key":"rewrite","status":"done","detail":"原问题足够清晰"}',
        '',
        'event: stage',
        'data: {"key":"synthesize","status":"start"}',
        '',
        'event: delta',
        'data: {"text":"这是来自 Wiki 的测试答案。"}',
        '',
        'event: stage',
        'data: {"key":"synthesize","status":"done","detail":"综合完成"}',
        '',
        'event: done',
        'data: {"citedConceptIds":[],"archivable":false,"suggestedQuestions":[],"stageDurations":{"rewrite":1,"synthesize":2}}',
        '',
      ].join('\n'),
    });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: '问答' }).click();
  await page.getByLabel('输入问题').fill('这个知识库里有什么内容？');
  await page.getByLabel('发送问题').click();

  await expect(page.getByText('思考过程')).toBeVisible();
  await expect(page.getByText('这是来自 Wiki 的测试答案。')).toBeVisible();
});
