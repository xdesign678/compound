import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_HISTORY_KEY,
  APP_HISTORY_OWNER,
  APP_HISTORY_VERSION,
  MAX_DETAIL_CHAIN_DEPTH,
  canSafelyGoBack,
  closeAppHistoryDetail,
  createDetailHistoryState,
  createShellHistoryState,
  establishAppHistoryShell,
  fromStoreDetail,
  hydrateUiFromHistoryState,
  parseAppHistoryState,
  pushAppHistoryDetail,
  replaceAppHistoryTab,
  finalizeAppHistoryTabCollapse,
  isAppHistoryTabCollapsePending,
  toStoreDetail,
  withAppHistoryHydration,
} from './app-history';

interface MemoryHistory {
  stack: unknown[];
  index: number;
  pushCount: number;
  replaceCount: number;
  backCount: number;
  goCount: number;
  lastGoDelta: number | null;
}

function installMemoryHistory(options?: {
  pathname?: string;
  initialState?: unknown;
  priorEntries?: unknown[];
}): MemoryHistory {
  const prior = options?.priorEntries ?? [];
  const stack = [...prior, options?.initialState ?? null];
  const memory: MemoryHistory = {
    stack,
    index: stack.length - 1,
    pushCount: 0,
    replaceCount: 0,
    backCount: 0,
    goCount: 0,
    lastGoDelta: null,
  };

  const history = {
    get length() {
      return memory.stack.length;
    },
    get state() {
      return memory.stack[memory.index] ?? null;
    },
    pushState(state: unknown) {
      memory.stack.splice(memory.index + 1);
      memory.stack.push(state);
      memory.index = memory.stack.length - 1;
      memory.pushCount += 1;
    },
    replaceState(state: unknown) {
      memory.stack[memory.index] = state;
      memory.replaceCount += 1;
    },
    back() {
      memory.backCount += 1;
      if (memory.index > 0) memory.index -= 1;
    },
    forward() {
      if (memory.index < memory.stack.length - 1) memory.index += 1;
    },
    go(delta: number) {
      memory.goCount += 1;
      memory.lastGoDelta = delta;
      const next = memory.index + delta;
      if (next < 0 || next >= memory.stack.length) return;
      memory.index = next;
    },
  };

  const windowLike = {
    history,
    location: { pathname: options?.pathname ?? '/' },
  };
  Object.defineProperty(globalThis, 'window', { value: windowLike, configurable: true });
  Object.defineProperty(globalThis, 'history', { value: history, configurable: true });
  return memory;
}

test('parseAppHistoryState accepts a versioned Compound shell and detail', () => {
  const shell = parseAppHistoryState({
    [APP_HISTORY_KEY]: createShellHistoryState('wiki'),
  });
  assert.deepEqual(shell, {
    v: APP_HISTORY_VERSION,
    owner: APP_HISTORY_OWNER,
    tab: 'wiki',
  });

  const detail = parseAppHistoryState({
    [APP_HISTORY_KEY]: createDetailHistoryState('sources', { kind: 'source', id: 's-1' }, true),
  });
  assert.equal(detail?.tab, 'sources');
  assert.equal(detail?.detail?.kind, 'source');
  assert.equal(detail?.detail?.id, 's-1');
  assert.equal(detail?.pushedFromApp, true);
  assert.equal(detail?.depth, 1);
});

test('parseAppHistoryState rejects unknown, malformed, and non-Compound state', () => {
  const rejected = [
    null,
    undefined,
    'wiki',
    1,
    [],
    {},
    { detail: { type: 'concept', id: 'c-1' } },
    { [APP_HISTORY_KEY]: { v: 2, owner: APP_HISTORY_OWNER, tab: 'wiki' } },
    { [APP_HISTORY_KEY]: { v: 1, owner: 'other', tab: 'wiki' } },
    { [APP_HISTORY_KEY]: { v: 1, owner: APP_HISTORY_OWNER, tab: 'inbox' } },
    {
      [APP_HISTORY_KEY]: {
        v: 1,
        owner: APP_HISTORY_OWNER,
        tab: 'wiki',
        detail: { kind: 'note', id: 'n1' },
      },
    },
    {
      [APP_HISTORY_KEY]: {
        v: 1,
        owner: APP_HISTORY_OWNER,
        tab: 'wiki',
        detail: { kind: 'concept' },
      },
    },
    {
      [APP_HISTORY_KEY]: {
        v: 1,
        owner: APP_HISTORY_OWNER,
        tab: 'wiki',
        detail: { kind: 'category', id: 'x' },
      },
    },
    {
      [APP_HISTORY_KEY]: {
        v: 1,
        owner: APP_HISTORY_OWNER,
        tab: 'wiki',
        pushedFromApp: 'yes',
      },
    },
    {
      [APP_HISTORY_KEY]: {
        v: 1,
        owner: APP_HISTORY_OWNER,
        tab: 'wiki',
        detail: { kind: 'concept', id: 'c-1' },
        depth: 0,
      },
    },
    {
      [APP_HISTORY_KEY]: {
        v: 1,
        owner: APP_HISTORY_OWNER,
        tab: 'wiki',
        detail: { kind: 'concept', id: 'c-1' },
        depth: 99,
      },
    },
  ];
  for (const raw of rejected) {
    assert.equal(parseAppHistoryState(raw), null);
  }
});

test('hydrateUiFromHistoryState maps valid state and falls back without trusting junk', () => {
  const valid = hydrateUiFromHistoryState({
    [APP_HISTORY_KEY]: createDetailHistoryState('wiki', { kind: 'concept', id: 'c-seed-1' }, true),
  });
  assert.deepEqual(valid, {
    tab: 'wiki',
    detail: { type: 'concept', id: 'c-seed-1' },
  });

  const category = hydrateUiFromHistoryState({
    [APP_HISTORY_KEY]: createDetailHistoryState(
      'wiki',
      {
        kind: 'category',
        id: 'category-wiki:人工智能/知识系统',
        category: { primary: '人工智能', secondary: '知识系统' },
      },
      true,
    ),
  });
  assert.deepEqual(category.detail, {
    type: 'category-wiki',
    id: 'category-wiki:人工智能/知识系统',
    primary: '人工智能',
    secondary: '知识系统',
  });

  assert.deepEqual(hydrateUiFromHistoryState({ detail: { type: 'concept', id: 'c-1' } }), {
    detail: null,
  });
});

test('store detail conversion round-trips concept, source, and category locators', () => {
  assert.deepEqual(fromStoreDetail({ type: 'concept', id: 'c-1' }), {
    kind: 'concept',
    id: 'c-1',
  });
  assert.deepEqual(toStoreDetail({ kind: 'source', id: 's-1' }), {
    type: 'source',
    id: 's-1',
  });
  const category = fromStoreDetail({
    type: 'category-wiki',
    id: 'ignored',
    primary: '人工智能',
    secondary: '知识系统',
  });
  assert.ok(category);
  assert.deepEqual(toStoreDetail(category), {
    type: 'category-wiki',
    id: 'category-wiki:人工智能/知识系统',
    primary: '人工智能',
    secondary: '知识系统',
  });
  assert.equal(fromStoreDetail({ type: 'concept', id: '' }), null);
});

test('establishAppHistoryShell replaces an untrusted landing entry and is idempotent', () => {
  const memory = installMemoryHistory({ initialState: { next: true } });
  const first = establishAppHistoryShell('wiki');
  const second = establishAppHistoryShell('sources');
  assert.equal(memory.replaceCount, 1);
  assert.equal(memory.pushCount, 0);
  assert.equal(first.tab, 'wiki');
  assert.equal(second.tab, 'wiki');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'wiki');
});

test('tab replace does not grow the stack, and opening details pushes one entry each', () => {
  const memory = installMemoryHistory();
  establishAppHistoryShell('wiki');
  replaceAppHistoryTab('sources');
  replaceAppHistoryTab('ask');
  replaceAppHistoryTab('activity');
  assert.equal(memory.stack.length, 1);
  assert.equal(memory.pushCount, 0);
  assert.equal(parseAppHistoryState(memory.stack[0])?.tab, 'activity');

  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-b' });
  assert.equal(memory.pushCount, 2);
  assert.equal(memory.stack.length, 3);
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail?.id, 'c-b');
});

test('closeAppHistoryDetail uses history.back only for an app-owned pushed detail', () => {
  const memory = installMemoryHistory({ priorEntries: [{ external: true }] });
  establishAppHistoryShell('wiki');
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  assert.equal(canSafelyGoBack(), true);
  assert.equal(closeAppHistoryDetail('wiki'), 'back');
  assert.equal(memory.backCount, 1);
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);

  const unsafe = installMemoryHistory({ initialState: { junk: true } });
  assert.equal(canSafelyGoBack(), false);
  assert.equal(closeAppHistoryDetail('wiki'), 'replace');
  assert.equal(unsafe.backCount, 0);
  assert.equal(parseAppHistoryState(unsafe.stack[unsafe.index])?.tab, 'wiki');
  assert.equal(parseAppHistoryState(unsafe.stack[unsafe.index])?.detail, undefined);
});

test('history writes are skipped during popstate hydration and off the app shell path', () => {
  const memory = installMemoryHistory();
  establishAppHistoryShell('wiki');
  withAppHistoryHydration(() => {
    pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
    replaceAppHistoryTab('sources');
    assert.equal(closeAppHistoryDetail('wiki'), 'replace');
  });
  assert.equal(memory.pushCount, 0);
  assert.equal(parseAppHistoryState(memory.stack[0])?.tab, 'wiki');

  const recap = installMemoryHistory({ pathname: '/recap' });
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  replaceAppHistoryTab('sources');
  assert.equal(closeAppHistoryDetail('wiki'), 'replace');
  assert.equal(recap.pushCount, 0);
  assert.equal(recap.replaceCount, 0);
  assert.equal(canSafelyGoBack(), false);
});

test('StrictMode-style duplicate establish does not push extra entries', () => {
  const memory = installMemoryHistory();
  establishAppHistoryShell('wiki');
  establishAppHistoryShell('wiki');
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  assert.equal(memory.pushCount, 1);
  assert.equal(memory.replaceCount, 1);
  assert.equal(memory.stack.length, 2);
});

test('A then B still traverses with browser back and forward before a tab switch', () => {
  const memory = installMemoryHistory();
  establishAppHistoryShell('wiki');
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-b' });
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail?.id, 'c-b');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.depth, 2);

  (globalThis.history as { back: () => void }).back();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail?.id, 'c-a');
  (globalThis.history as { forward: () => void }).forward();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail?.id, 'c-b');
});

test('tab switch from detail B collapses the A/B chain so back cannot resurrect A', () => {
  const memory = installMemoryHistory({
    initialState: { __na: true, idx: 7 },
  });
  establishAppHistoryShell('wiki');
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-b' });
  assert.equal((memory.stack[0] as { __na?: boolean }).__na, true);

  replaceAppHistoryTab('sources');
  assert.equal(memory.goCount, 1);
  assert.equal(memory.lastGoDelta, -2);
  assert.equal(isAppHistoryTabCollapsePending(), true);
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);

  assert.equal(finalizeAppHistoryTabCollapse(), true);
  assert.equal(isAppHistoryTabCollapsePending(), false);
  const current = parseAppHistoryState(memory.stack[memory.index]);
  assert.equal(current?.tab, 'sources');
  assert.equal(current?.detail, undefined);
  assert.equal((memory.stack[memory.index] as { __na?: boolean }).__na, true);
  assert.equal(
    memory.stack.some((entry) => parseAppHistoryState(entry)?.detail),
    false,
  );

  (globalThis.history as { back: () => void }).back();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'wiki');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
  (globalThis.history as { forward: () => void }).forward();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'sources');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
});

test('tab switch from a single pushed detail also discards that detail from Back', () => {
  const memory = installMemoryHistory();
  establishAppHistoryShell('wiki');
  pushAppHistoryDetail('wiki', { kind: 'concept', id: 'c-a' });
  replaceAppHistoryTab('activity');
  assert.equal(memory.lastGoDelta, -1);
  finalizeAppHistoryTabCollapse();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'activity');
  (globalThis.history as { back: () => void }).back();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
});

test('opening past the detail-chain cap replaces the top entry and stays parseable', () => {
  const overCap = createDetailHistoryState('wiki', { kind: 'concept', id: 'c-over' }, true, 33);
  assert.equal(overCap.depth, MAX_DETAIL_CHAIN_DEPTH);
  assert.equal(parseAppHistoryState({ [APP_HISTORY_KEY]: overCap })?.depth, MAX_DETAIL_CHAIN_DEPTH);

  const memory = installMemoryHistory({ priorEntries: [{ external: true }] });
  establishAppHistoryShell('wiki');
  const extraOpens = 8;
  const totalOpens = MAX_DETAIL_CHAIN_DEPTH + extraOpens;
  for (let index = 1; index <= totalOpens; index += 1) {
    pushAppHistoryDetail('wiki', { kind: 'concept', id: `c-${index}` });
  }

  const appOwned = memory.stack.filter((entry) => parseAppHistoryState(entry));
  assert.equal(memory.stack.length, 2 + MAX_DETAIL_CHAIN_DEPTH);
  assert.equal(appOwned.length, 1 + MAX_DETAIL_CHAIN_DEPTH);
  assert.equal(
    appOwned.every((entry) => parseAppHistoryState(entry) !== null),
    true,
  );
  const current = parseAppHistoryState(memory.stack[memory.index]);
  assert.equal(current?.detail?.id, `c-${totalOpens}`);
  assert.equal(current?.depth, MAX_DETAIL_CHAIN_DEPTH);
  assert.equal(current?.pushedFromApp, true);
  assert.equal(
    memory.stack.some((entry) => {
      const record = (entry as Record<string, { depth?: number } | undefined>)?.[APP_HISTORY_KEY];
      return typeof record?.depth === 'number' && record.depth > MAX_DETAIL_CHAIN_DEPTH;
    }),
    false,
  );

  const indexBeforeCollapse = memory.index;
  replaceAppHistoryTab('sources');
  assert.equal(memory.lastGoDelta, -MAX_DETAIL_CHAIN_DEPTH);
  assert.equal(memory.index, indexBeforeCollapse - MAX_DETAIL_CHAIN_DEPTH);
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'wiki');
  assert.deepEqual(memory.stack[0], { external: true });

  finalizeAppHistoryTabCollapse();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'sources');
  assert.equal(
    memory.stack.some((entry) => parseAppHistoryState(entry)?.detail),
    false,
  );
  assert.equal(memory.stack.length, 3);

  (globalThis.history as { back: () => void }).back();
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.tab, 'wiki');
  assert.equal(parseAppHistoryState(memory.stack[memory.index])?.detail, undefined);
  (globalThis.history as { back: () => void }).back();
  assert.deepEqual(memory.stack[memory.index], { external: true });
});
