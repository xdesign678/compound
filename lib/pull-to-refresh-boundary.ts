interface PullBoundaryInput {
  target: HTMLElement;
  root: HTMLElement;
  getOverflowY?: (element: HTMLElement) => string;
}

const FORM_FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function canStartPullToRefresh({
  target,
  root,
  getOverflowY = getElementOverflowY,
}: PullBoundaryInput): boolean {
  if (FORM_FIELD_TAGS.has(target.tagName)) return false;
  const scrollableAncestor = findNearestScrollableAncestor(target, root, getOverflowY);
  if (scrollableAncestor !== root) return false;
  return (root.scrollTop ?? 0) <= 2;
}

export function findNearestScrollableAncestor(
  target: HTMLElement,
  root: HTMLElement,
  getOverflowY: (element: HTMLElement) => string = getElementOverflowY,
): HTMLElement | null {
  let current: HTMLElement | null = target;
  while (current) {
    if (current === root) return root;
    if (isScrollableElement(current, getOverflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

function isScrollableElement(
  element: HTMLElement,
  getOverflowY: (element: HTMLElement) => string,
): boolean {
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  return /auto|scroll|overlay/.test(getOverflowY(element));
}

function getElementOverflowY(element: HTMLElement): string {
  return window.getComputedStyle(element).overflowY;
}
