import test from 'node:test';
import assert from 'node:assert/strict';

import { canStartPullToRefresh } from './pull-to-refresh-boundary';

function makeElement({
  parent = null,
  scrollTop = 0,
  scrollHeight = 100,
  clientHeight = 100,
  tagName = 'DIV',
}: {
  parent?: HTMLElement | null;
  scrollTop?: number;
  scrollHeight?: number;
  clientHeight?: number;
  tagName?: string;
} = {}): HTMLElement {
  return {
    parentElement: parent,
    scrollTop,
    scrollHeight,
    clientHeight,
    tagName,
  } as HTMLElement;
}

test('pull-to-refresh starts from root scroll when root is at top', () => {
  const root = makeElement({ scrollHeight: 1000, clientHeight: 600 });
  const child = makeElement({ parent: root });

  assert.equal(
    canStartPullToRefresh({
      target: child,
      root,
      getOverflowY: (element) => (element === root ? 'auto' : 'visible'),
    }),
    true,
  );
});

test('pull-to-refresh does not start inside a nested scroll container', () => {
  const root = makeElement({ scrollHeight: 1000, clientHeight: 600 });
  const modalScroll = makeElement({
    parent: root,
    scrollHeight: 900,
    clientHeight: 500,
  });
  const child = makeElement({ parent: modalScroll });

  assert.equal(
    canStartPullToRefresh({
      target: child,
      root,
      getOverflowY: (element) => (element === modalScroll ? 'auto' : 'visible'),
    }),
    false,
  );
});

test('pull-to-refresh ignores form fields', () => {
  const root = makeElement({ scrollHeight: 1000, clientHeight: 600 });
  const textarea = makeElement({ parent: root, tagName: 'TEXTAREA' });

  assert.equal(
    canStartPullToRefresh({
      target: textarea,
      root,
      getOverflowY: () => 'visible',
    }),
    false,
  );
});
