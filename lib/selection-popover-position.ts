export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface SizeLike {
  width: number;
  height: number;
}

interface ComputeSelectionPopoverPositionInput {
  anchorRect: RectLike;
  viewport: SizeLike;
  popover: SizeLike;
  edgePadding?: number;
  gap?: number;
}

export function computeSelectionPopoverPosition({
  anchorRect,
  viewport,
  popover,
  edgePadding = 8,
  gap = 12,
}: ComputeSelectionPopoverPositionInput): { top: number; left: number } {
  const anchorHeight = anchorRect.height || Math.max(0, anchorRect.bottom - anchorRect.top);
  const anchorCenterY = anchorRect.top + anchorHeight / 2;
  const maxTop = viewport.height - popover.height - edgePadding;
  const top = clamp(Math.round(anchorCenterY - popover.height / 2), edgePadding, maxTop);

  const rightSide = anchorRect.right + gap;
  if (rightSide + popover.width <= viewport.width - edgePadding) {
    return { top, left: Math.round(rightSide) };
  }

  const leftSide = anchorRect.left - popover.width - gap;
  if (leftSide >= edgePadding) {
    return { top, left: Math.round(leftSide) };
  }

  const anchorWidth = anchorRect.width || Math.max(0, anchorRect.right - anchorRect.left);
  const centered = anchorRect.left + anchorWidth / 2 - popover.width / 2;
  const maxLeft = viewport.width - popover.width - edgePadding;
  return { top, left: clamp(Math.round(centered), edgePadding, maxLeft) };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
