import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSelectionPopoverPosition,
  getSelectionChangeAction,
} from './selection-popover-position';

test('selection popover prefers the actual text anchor instead of the justified line edge', () => {
  const position = computeSelectionPopoverPosition({
    anchorRect: {
      left: 1128,
      right: 1128,
      top: 88,
      bottom: 132,
      width: 0,
      height: 44,
    },
    viewport: { width: 1712, height: 900 },
    popover: { width: 180, height: 44 },
  });

  assert.equal(position.left, 1140);
  assert.equal(position.top, 88);
  assert.ok(position.left < 1300, 'popover should stay beside the selected words');
});

test('selection popover flips to the left when the right side would overflow', () => {
  const position = computeSelectionPopoverPosition({
    anchorRect: {
      left: 1650,
      right: 1650,
      top: 100,
      bottom: 140,
      width: 0,
      height: 40,
    },
    viewport: { width: 1712, height: 900 },
    popover: { width: 180, height: 44 },
  });

  assert.equal(position.left, 1458);
  assert.equal(position.top, 98);
});

test('selectionchange refreshes the popover for a new active selection', () => {
  assert.equal(
    getSelectionChangeAction({
      creatingFromSelection: false,
      hasSelection: true,
      isCollapsed: false,
      suppressDismiss: false,
    }),
    'refresh',
  );
});
