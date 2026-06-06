'use client';

const DEFAULT_POPOVER_HEIGHT = 44;
const DEFAULT_EDGE_PADDING = 8;

interface VisibleViewportLike {
  offsetTop: number;
  height: number;
}

interface WindowViewportLike {
  innerHeight: number;
  visualViewport?: VisibleViewportLike | null;
}

export function getVisibleViewportBottom(win: WindowViewportLike): number {
  const visualViewport = win.visualViewport;
  if (!visualViewport) return win.innerHeight;
  return visualViewport.offsetTop + visualViewport.height;
}

export function clampPopoverTopToVisibleViewport({
  desiredTop,
  popoverHeight = DEFAULT_POPOVER_HEIGHT,
  viewportBottom,
  edgePadding = DEFAULT_EDGE_PADDING,
}: {
  desiredTop: number;
  popoverHeight?: number;
  viewportBottom: number;
  edgePadding?: number;
}): number {
  const maxTop = viewportBottom - popoverHeight - edgePadding;
  if (maxTop < edgePadding) return edgePadding;
  return Math.min(Math.max(desiredTop, edgePadding), maxTop);
}
