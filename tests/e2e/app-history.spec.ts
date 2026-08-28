import { expect, test, type Page } from '@playwright/test';

import { APP_HISTORY_KEY } from '../../lib/app-history';

const CONCEPT_A = { id: 'c-seed-1', title: 'LLM Wiki 模式' };
const CONCEPT_B = { id: 'c-seed-2', title: 'RAG 的结构性缺陷' };

declare global {
  interface Window {
    __compoundHistoryCalls?: { push: number; replace: number };
  }
}

async function stubEmptySnapshot(page: Page) {
  let servedAuthoritativeSnapshot = false;
  await page.route('**/api/data/snapshot**', async (route) => {
    if (servedAuthoritativeSnapshot) {
      await route.fulfill({ status: 503, body: 'history fixture is local-only after bootstrap' });
      return;
    }
    servedAuthoritativeSnapshot = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: Date.now(),
        mode: 'full',
        dataset: { datasetId: 'history-empty-dataset', generation: 1 },
        pagination: {
          limit: 1000,
          offset: 0,
          totalSources: 0,
          totalConcepts: 0,
          totalActivity: 0,
          totalAsk: 0,
        },
        counts: { sources: 0, concepts: 0, activity: 0, ask: 0 },
        sources: [],
        concepts: [],
        activity: [],
        ask: [],
        sync: {
          cursor: 0,
          upperCursor: 0,
          hasMore: false,
          deleted: { sources: [], concepts: [], activity: [], ask: [] },
        },
      }),
    });
  });
}

async function installHistoryCounters(page: Page) {
  await page.addInitScript((key: string) => {
    const calls = { push: 0, replace: 0 };
    window.__compoundHistoryCalls = calls;
    const originalPush = history.pushState.bind(history);
    const originalReplace = history.replaceState.bind(history);
    history.pushState = function pushState(data, unused, url) {
      if (data && typeof data === 'object' && key in data) calls.push += 1;
      return originalPush(data, unused, url);
    };
    history.replaceState = function replaceState(data, unused, url) {
      if (data && typeof data === 'object' && key in data) calls.replace += 1;
      return originalReplace(data, unused, url);
    };
  }, APP_HISTORY_KEY);
}

async function gotoSeededHome(page: Page) {
  await stubEmptySnapshot(page);
  await installHistoryCounters(page);
  await page.goto('/');
  await expect(page.locator('.concept-card').first()).toBeVisible({ timeout: 40_000 });
}

async function openConcept(page: Page, id: string) {
  await page.locator(`[data-concept-id="${id}"]`).click();
}

async function expectDetailTitle(page: Page, title: string) {
  await expect(page.locator('.concept-detail h1')).toHaveText(title);
}

async function expectDetailClosed(page: Page) {
  await expect(page.locator('.library-detail-overlay.is-open')).toHaveCount(0);
  await expect(page.locator('.mobile-detail-overlay')).toHaveCount(0);
}

async function expectHistoryShell(page: Page, tab: string) {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ key, tabId }) => {
          const raw = window.history.state;
          const state =
            raw && typeof raw === 'object'
              ? (raw as Record<string, { tab?: string; detail?: unknown }>)[key]
              : null;
          return Boolean(state && state.tab === tabId && state.detail === undefined);
        },
        { key: APP_HISTORY_KEY, tabId: tab },
      ),
    )
    .toBe(true);
}

async function closeDetailViaUi(page: Page) {
  const closeButton = page.getByRole('button', { name: '关闭' });
  const backButton = page.getByRole('button', { name: '返回' });
  if (await closeButton.isVisible()) {
    await closeButton.click();
    return;
  }
  await backButton.click();
}

async function readCompoundPushCount(page: Page) {
  return page.evaluate(() => window.__compoundHistoryCalls?.push ?? 0);
}

async function swipeBackFromEdge(page: Page) {
  const y = Math.round((page.viewportSize()?.height ?? 667) * 0.45);
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 12, y, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 62, y, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 140, y, id: 1 }],
  });
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

test('list card then UI return then browser back does not reopen a ghost detail', async ({
  page,
}) => {
  await gotoSeededHome(page);
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);

  await closeDetailViaUi(page);
  await expectDetailClosed(page);
  await expect(page.locator(`[data-concept-id="${CONCEPT_A.id}"]`)).toBeVisible();

  await page.goBack();
  await expectDetailClosed(page);
  await expect(page.locator('.concept-detail h1')).toHaveCount(0);
});

test('detail A to B then browser back and forward traverses deterministically', async ({
  page,
}) => {
  await gotoSeededHome(page);
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);

  await page.locator('.related-chip', { hasText: CONCEPT_B.title }).click();
  await expectDetailTitle(page, CONCEPT_B.title);

  await page.goBack();
  await expectDetailTitle(page, CONCEPT_A.title);

  await page.goForward();
  await expectDetailTitle(page, CONCEPT_B.title);
});

test('tab switches replace history instead of growing a ghost stack', async ({ page }) => {
  await gotoSeededHome(page);
  const before = await page.evaluate(() => ({
    length: history.length,
    push: window.__compoundHistoryCalls?.push ?? 0,
  }));

  await page.getByRole('tab', { name: '原始资料' }).click();
  await page.getByRole('tab', { name: '问答' }).click();
  await page.getByRole('tab', { name: '活动' }).click();

  const after = await page.evaluate(() => ({
    length: history.length,
    push: window.__compoundHistoryCalls?.push ?? 0,
    tab: document.querySelector('[role="tab"][aria-selected="true"]')?.id ?? '',
  }));
  expect(after.push).toBe(before.push);
  expect(after.length).toBe(before.length);
  expect(after.tab).toBe('tab-activity');

  await page.goBack();
  if (new URL(page.url()).pathname === '/') {
    await expect(page.getByRole('tab', { name: '活动' })).toHaveAttribute('aria-selected', 'true');
  }
});

test('Escape closes detail with the same no-ghost contract as the UI close', async ({ page }) => {
  await gotoSeededHome(page);
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);

  await page.keyboard.press('Escape');
  await expectDetailClosed(page);

  await page.goBack();
  await expectDetailClosed(page);
  await expect(page.locator('.concept-detail h1')).toHaveCount(0);
});

test('refresh restores a valid app-owned detail and malformed state falls back to the shell', async ({
  page,
}) => {
  await gotoSeededHome(page);
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);

  await page.reload();
  await expectDetailTitle(page, CONCEPT_A.title);

  await page.evaluate((key) => {
    history.replaceState({ [key]: { v: 99, owner: 'nope', tab: 'wiki' } }, '', '/');
  }, APP_HISTORY_KEY);
  await page.reload();
  await expect(page.locator('.concept-card').first()).toBeVisible({ timeout: 40_000 });
  await expectDetailClosed(page);
  await expect(page.locator('.concept-detail h1')).toHaveCount(0);
});

test('tab switch from detail B collapses A/B so browser back does not resurrect A', async ({
  page,
}) => {
  await gotoSeededHome(page);
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);
  await page.locator('.related-chip', { hasText: CONCEPT_B.title }).click();
  await expectDetailTitle(page, CONCEPT_B.title);

  await page
    .locator('.desktop-sidebar .tab-item', { hasText: '原始资料' })
    .evaluate((element) => (element as HTMLButtonElement).click());
  await expectDetailClosed(page);
  await expectHistoryShell(page, 'sources');
  await expect(page.getByRole('tab', { name: '原始资料' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.goBack();
  await expectDetailClosed(page);
  await expect(page.locator('.concept-detail h1')).toHaveCount(0);
});

test('keyboard and command tab switch from detail B also collapse the chain', async ({ page }) => {
  await gotoSeededHome(page);
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);
  await page.locator('.related-chip', { hasText: CONCEPT_B.title }).click();
  await expectDetailTitle(page, CONCEPT_B.title);

  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expectDetailClosed(page);
  await expectHistoryShell(page, 'sources');
  await expect(page.getByRole('tab', { name: '原始资料' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goBack();
  await expectDetailClosed(page);
  await expect(page.locator('.concept-detail h1')).toHaveCount(0);

  await page.getByRole('tab', { name: '我的 Wiki' }).click();
  await expectHistoryShell(page, 'wiki');
  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);
  await page.locator('.related-chip', { hasText: CONCEPT_B.title }).click();
  await expectDetailTitle(page, CONCEPT_B.title);

  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: '切换到活动' }).click();
  await expectDetailClosed(page);
  await expectHistoryShell(page, 'activity');
  await expect(page.getByRole('tab', { name: '活动' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expectDetailClosed(page);
  await expect(page.locator('.concept-detail h1')).toHaveCount(0);
});

test('React StrictMode does not duplicate a detail push', async ({ page }) => {
  await gotoSeededHome(page);
  const before = await readCompoundPushCount(page);
  expect(before).toBe(0);

  await openConcept(page, CONCEPT_A.id);
  await expectDetailTitle(page, CONCEPT_A.title);
  expect(await readCompoundPushCount(page)).toBe(1);
});

test.describe('mobile swipe and header back', () => {
  test.use({
    viewport: { width: 375, height: 667 },
    hasTouch: true,
    isMobile: true,
  });

  test('swipe and UI back both close detail without leaving a ghost entry', async ({ page }) => {
    await gotoSeededHome(page);
    await openConcept(page, CONCEPT_A.id);
    await expect(page.locator('.mobile-detail-overlay')).toBeVisible();
    await expectDetailTitle(page, CONCEPT_A.title);

    await swipeBackFromEdge(page);
    await expectDetailClosed(page);

    await openConcept(page, CONCEPT_A.id);
    await expectDetailTitle(page, CONCEPT_A.title);
    await page.getByRole('button', { name: '返回' }).click();
    await expectDetailClosed(page);

    await page.goBack();
    await expectDetailClosed(page);
    await expect(page.locator('.concept-detail h1')).toHaveCount(0);
  });
});
