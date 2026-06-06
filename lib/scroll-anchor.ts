/**
 * Pure scroll-anchor selection logic.
 *
 * Given an ordered list of element IDs and a set of IDs that are currently
 * "visible" (intersecting the detection band), returns the first visible ID
 * (by document order), or null if nothing is visible.
 *
 * Extracted as a pure function so it can be unit-tested without a DOM.
 */

/**
 * Select the scroll-anchor ID: the first element in `orderedIds` that also
 * appears in `visibleIds`.
 *
 * @param orderedIds - IDs in DOM order (top-to-bottom in the scroll container).
 * @param visibleIds - IDs of elements currently intersecting the detection band.
 * @returns The anchor ID, or null if no element is visible.
 */
export function selectScrollAnchor(orderedIds: string[], visibleIds: Set<string>): string | null {
  for (const id of orderedIds) {
    if (visibleIds.has(id)) return id;
  }
  return null;
}

/**
 * Compute the CSS custom-property value for `--ask-input-height`.
 *
 * @param barHeight - The `.ask-input-bar` offsetHeight, or 0 if absent.
 * @returns The CSS value string (e.g. `"48px"` or `"0px"`).
 */
export function computeAskInputHeightValue(barHeight: number): string {
  return `${Math.max(0, barHeight)}px`;
}
