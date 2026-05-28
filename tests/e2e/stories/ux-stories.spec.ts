import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Page, type TestInfo } from '@playwright/test';

const STORIES_DIR = join(process.cwd(), 'tmp/ux-audit/stories');

test.use({ trace: 'off' });

async function withStoryTrace(
  page: Page,
  testInfo: TestInfo,
  storyId: string,
  run: () => Promise<void>,
) {
  await mkdir(STORIES_DIR, { recursive: true });
  const tracePath = join(STORIES_DIR, `${storyId}.zip`);
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await run();
  } finally {
    await page.context().tracing.stop({ path: tracePath });
    await testInfo.attach(`${storyId}-trace`, { path: tracePath, contentType: 'application/zip' });
  }
}

async function stubEmptySnapshot(page: Page) {
  await page.route('**/api/data/snapshot**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: Date.now(),
        mode: 'full',
        counts: { sources: 0, concepts: 0, activity: 0, ask: 0 },
        sources: [],
        concepts: [],
        activity: [],
        ask: [],
      }),
    });
  });
}

async function seedManyConcepts(page: Page, count: number) {
  await page.evaluate(async (total) => {
    function openDb(): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('compound-db');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }

    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['sources', 'concepts', 'activity', 'askHistory'], 'readwrite');
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      tx.objectStore('sources').clear();
      tx.objectStore('concepts').clear();
      tx.objectStore('activity').clear();
      tx.objectStore('askHistory').clear();
      tx.objectStore('sources').put({
        id: 'story-source-1k',
        title: '1k 概念压力资料',
        type: 'article',
        author: 'E2E',
        rawContent: '用于验证大列表渲染和分页加载的本地资料。',
        ingestedAt: Date.now(),
        contentStatus: 'full',
      });
      const concepts = tx.objectStore('concepts');
      for (let i = 0; i < total; i += 1) {
        concepts.put({
          id: `story-concept-${i}`,
          title: `压力测试概念 ${String(i + 1).padStart(4, '0')}`,
          summary: `第 ${i + 1} 个本地概念，用于验证 1k 列表仍能稳定分页和搜索。`,
          body: `# 压力测试概念 ${i + 1}\n\n这是 E2E 注入的测试概念。`,
          sources: ['story-source-1k'],
          related: i > 0 ? [`story-concept-${i - 1}`] : [],
          createdAt: Date.now() - i,
          updatedAt: Date.now() - i,
          version: 1,
          contentStatus: 'full',
          categories: [{ primary: '测试', secondary: '压力' }],
          categoryKeys: ['测试', '测试/压力'],
        });
      }
    });
    db.close();
    localStorage.setItem('compound_seeded', '1');
    localStorage.removeItem('compound_is_sample');
  }, count);
}

async function openFirstSourceBlockForEditing(page: Page) {
  const firstBlock = page.getByRole('group', { name: '内容块' }).first();
  await expect(firstBlock).toBeVisible();
  await firstBlock.click();
  const editor = page.getByLabel('编辑内容块');
  await expect(editor).toBeVisible();
  return editor;
}

test('story: first visit reaches a usable seeded wiki', async ({ page }, testInfo) => {
  await stubEmptySnapshot(page);
  await withStoryTrace(page, testInfo, 'first-visit', async () => {
    await page.goto('/');

    await expect(page.locator('.desktop-brand-kicker')).toHaveText('Compound');
    await expect(page.getByRole('tab', { name: 'Wiki' })).toBeVisible();
    await expect(page.locator('.concept-card').first()).toBeVisible();
    await expect(page.getByLabel('搜索概念')).toBeVisible();
  });
});

test('story: offline source edit survives until reconnect and save', async ({ page }, testInfo) => {
  await stubEmptySnapshot(page);
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

  await withStoryTrace(page, testInfo, 'offline-edit-reconnect', async () => {
    await page.goto('/');
    await page.getByRole('tab', { name: '资料' }).click();
    await page.locator('.source-card').first().click();

    const editor = await openFirstSourceBlockForEditing(page);
    await page.context().setOffline(true);
    await editor.fill('## 离线编辑\n\n这段内容先在断网状态下编辑。');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: '离线编辑' })).toBeVisible();

    await page.context().setOffline(false);
    await page.getByRole('button', { name: '保存资料正文草稿' }).click();
    await expect(page.getByText('已保存')).toBeVisible();
  });
});

test('story: install readiness exposes manifest and offline shell assets', async ({
  page,
}, testInfo) => {
  await stubEmptySnapshot(page);
  await withStoryTrace(page, testInfo, 'install-readiness', async () => {
    await page.goto('/');
    const readiness = await page.evaluate(async () => {
      const manifestHref =
        document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? '';
      const manifestResponse = await fetch(manifestHref);
      const manifest = await manifestResponse.json();
      const serviceWorkerResponse = await fetch('/sw.js');
      const iconSizes = new Set(
        (manifest.icons ?? []).flatMap((icon: { sizes?: string }) =>
          String(icon.sizes ?? '')
            .split(/\s+/)
            .filter(Boolean),
        ),
      );
      return {
        manifestOk: manifestResponse.ok,
        serviceWorkerOk: serviceWorkerResponse.ok,
        name: manifest.name,
        startUrl: manifest.start_url,
        display: manifest.display,
        hasRequiredIcons: iconSizes.has('192x192') && iconSizes.has('512x512'),
        webAppCapable:
          document.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute('content') ===
            'yes' ||
          document
            .querySelector('meta[name="apple-mobile-web-app-capable"]')
            ?.getAttribute('content') === 'yes',
      };
    });

    expect(readiness).toMatchObject({
      manifestOk: true,
      serviceWorkerOk: true,
      startUrl: '/',
      display: 'standalone',
      hasRequiredIcons: true,
      webAppCapable: true,
    });
    expect(String(readiness.name)).toContain('Compound');
  });
});

test('story: 1k concepts render with stable pagination and search', async ({ page }, testInfo) => {
  await stubEmptySnapshot(page);
  await withStoryTrace(page, testInfo, 'one-thousand-concepts', async () => {
    await page.goto('/');
    await expect(page.locator('.concept-card').first()).toBeVisible();
    await seedManyConcepts(page, 1000);
    await page.reload({ waitUntil: 'networkidle' });

    await expect(page.getByText('已显示 60 / 1000 个概念')).toBeVisible();
    await expect(page.locator('.concept-card:not(.recap-entry-card)')).toHaveCount(60);
    await page.getByRole('button', { name: '加载更多' }).click();
    await expect(page.getByText('已显示 120 / 1000 个概念')).toBeVisible();

    await page.getByLabel('搜索概念').fill('0999');
    await expect(page.getByRole('button', { name: /压力测试概念 0999/ })).toBeVisible();
  });
});

test('story: slow network answer keeps the ask flow readable', async ({ page }, testInfo) => {
  await stubEmptySnapshot(page);
  await page.route('**/api/query', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        [
          'event: stage',
          'data: {"key":"retrieve","status":"start","detail":"慢网检索中"}',
          '',
          'event: stage',
          'data: {"key":"retrieve","status":"done","detail":"召回 3 个概念"}',
          '',
          'event: delta',
          'data: {"text":"慢网下仍然能返回可读答案。"}',
          '',
          'event: done',
          'data: {"citedConceptIds":[],"archivable":false,"suggestedQuestions":[],"stageDurations":{"retrieve":900}}',
          '',
        ].join('\n') + '\n',
    });
  });

  await withStoryTrace(page, testInfo, 'slow-network-answer', async () => {
    await page.goto('/');
    await expect(page.locator('.concept-card').first()).toBeVisible();
    await seedManyConcepts(page, 3);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('tab', { name: '问答' }).click();
    await page.getByLabel('输入问题').fill('慢网下这个知识库还能回答吗？');
    await page.getByLabel('发送问题').click();

    await expect(page.getByText('理解问题').first()).toBeVisible();
    await expect(page.getByText('慢网下仍然能返回可读答案。')).toBeVisible();
  });
});
