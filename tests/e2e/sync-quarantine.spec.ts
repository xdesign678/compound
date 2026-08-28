import { expect, test } from '@playwright/test';

const SNAPSHOT_PATH = '**/api/data/snapshot**';

function emptySnapshot() {
  return {
    fetchedAt: Date.now(),
    mode: 'full',
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
      cursor: 10,
      upperCursor: 10,
      hasMore: false,
      deleted: { sources: [], concepts: [], activity: [], ask: [] },
    },
    dataset: { datasetId: 'remote-dataset', generation: 1 },
  };
}

test('quarantine exports, can be dismissed, and requires confirmation before accepting remote', async ({
  page,
}) => {
  await page.route(SNAPSHOT_PATH, async (route) => {
    await route.fulfill({ status: 503, body: 'initial local setup only' });
  });
  await page.goto('/');
  await expect(page.locator('.desktop-brand-meta')).toHaveText('0 个概念 · 0 份资料', {
    timeout: 40_000,
  });

  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(
      ['sources', 'concepts', 'activity', 'askHistory', 'offlineOutbox', 'syncMeta'],
      'readwrite',
    );
    transaction.objectStore('sources').put({ id: 'local-source' });
    transaction.objectStore('concepts').put({ id: 'local-concept' });
    transaction.objectStore('activity').put({ id: 'local-activity' });
    transaction.objectStore('askHistory').put({ id: 'local-ask' });
    transaction.objectStore('offlineOutbox').put({ id: 'local-outbox' });
    transaction.objectStore('syncMeta').put({
      id: 'current',
      datasetId: 'local-dataset',
      generation: 1,
      cursor: 2,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
    localStorage.setItem('compound_llm_api_key', 'keep-byok');
  });

  await page.unroute(SNAPSHOT_PATH);
  await page.route(SNAPSHOT_PATH, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(emptySnapshot()) });
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: '本机副本已被保护' })).toBeVisible();
  await expect(page.getByText('activity 和问答记录在远端缺失，不等于会被删除。')).toBeVisible();

  await page.getByRole('button', { name: '暂时收起，继续保留本机' }).click();
  await expect(page.getByRole('heading', { name: '本机副本已被保护' })).toBeHidden();
  await page.reload();
  await expect(page.getByRole('heading', { name: '本机副本已被保护' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本机副本' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^compound-local-recovery-.*\.json$/);
  const downloadStream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of downloadStream) chunks.push(Buffer.from(chunk));
  const recovery = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    sources: Array<{ id: string }>;
    concepts: Array<{ id: string }>;
    activity: Array<{ id: string }>;
    askHistory: Array<{ id: string }>;
    syncMeta: { quarantine?: { reason?: string } };
  };
  expect(recovery.sources.map((row) => row.id)).toEqual(['local-source']);
  expect(recovery.concepts.map((row) => row.id)).toEqual(['local-concept']);
  expect(recovery.activity.map((row) => row.id)).toEqual(['local-activity']);
  expect(recovery.askHistory.map((row) => row.id)).toEqual(['local-ask']);
  expect(recovery.syncMeta.quarantine?.reason).toBe('identity_mismatch');

  await page.getByRole('button', { name: '接受远端副本' }).click();
  await expect(page.getByText('确认清空本机并接受远端')).toBeVisible();
  await page.getByRole('button', { name: '取消，保留本机副本' }).click();
  await expect(page.getByRole('heading', { name: '本机副本已被保护' })).toBeVisible();

  await page.getByRole('button', { name: '接受远端副本' }).click();
  await page.getByRole('button', { name: '确认清空本机并接受远端' }).click();
  await expect(page.getByRole('heading', { name: '本机副本已被保护' })).toBeHidden();

  const localState = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('compound-db');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(
      ['sources', 'concepts', 'activity', 'askHistory', 'offlineOutbox', 'syncMeta'],
      'readonly',
    );
    const count = (table: string) =>
      new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore(table).count();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    const syncMeta = new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      const request = transaction.objectStore('syncMeta').get('current');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const [sources, concepts, activity, askHistory, offlineOutbox, meta] = await Promise.all([
      count('sources'),
      count('concepts'),
      count('activity'),
      count('askHistory'),
      count('offlineOutbox'),
      syncMeta,
    ]);
    db.close();
    return {
      sources,
      concepts,
      activity,
      askHistory,
      offlineOutbox,
      meta,
      byok: localStorage.getItem('compound_llm_api_key'),
    };
  });

  expect(localState).toEqual({
    sources: 0,
    concepts: 0,
    activity: 0,
    askHistory: 0,
    offlineOutbox: 0,
    meta: {
      id: 'current',
      datasetId: 'remote-dataset',
      generation: 1,
      cursor: 10,
      quarantine: undefined,
    },
    byok: 'keep-byok',
  });
});
