import test from 'node:test';
import assert from 'node:assert/strict';

import { clampPopoverTopToVisibleViewport, getVisibleViewportBottom } from './useSelectionPopover';

test('selection popover clamps above the visual viewport bottom', () => {
  const top = clampPopoverTopToVisibleViewport({
    desiredTop: 720,
    popoverHeight: 44,
    viewportBottom: 680,
    edgePadding: 8,
  });

  assert.equal(top, 628);
});

test('selection popover keeps normal viewport bottom when visualViewport is absent', () => {
  const bottom = getVisibleViewportBottom({
    innerHeight: 812,
  });

  assert.equal(bottom, 812);
});

test('selection popover uses visualViewport offset plus height as keyboard top', () => {
  const bottom = getVisibleViewportBottom({
    innerHeight: 812,
    visualViewport: {
      offsetTop: 24,
      height: 520,
    },
  });

  assert.equal(bottom, 544);
});
