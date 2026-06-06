import { useEffect, useRef, useCallback } from 'react';
import { selectScrollAnchor } from '../scroll-anchor';

interface UseIntersectionAnchorOptions {
  /** CSS selector for the scroll container. */
  scrollRootSelector: string;
  /** CSS selector for the item cards to observe (e.g. '[data-concept-id]'). */
  itemSelector: string;
  /** Callback fired with the new anchor ID when it changes. */
  onAnchorChange: (anchorId: string | null) => void;
}

/**
 * Uses IntersectionObserver (with a detection band in the top 50% of the
 * scroll container) to track which card is the current scroll anchor.
 *
 * Replaces the previous per-frame `querySelectorAll` + `getBoundingClientRect`
 * forced-reflow approach. The IntersectionObserver callback fires only when
 * elements cross the detection-band boundary, which is far less frequent
 * than every scroll frame.
 */
export function useIntersectionAnchor({
  scrollRootSelector,
  itemSelector,
  onAnchorChange,
}: UseIntersectionAnchorOptions) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const intersectingIdsRef = useRef(new Set<string>());
  // Stabilise callback via ref so the IntersectionObserver isn't recreated
  // on every render when the consumer passes an inline function.
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;

  useEffect(() => {
    const root = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!root) return;

    // Capture ref values so the cleanup function doesn't reference .current
    // at a later point (satisfies react-hooks/exhaustive-deps).
    const intersectingIds = intersectingIdsRef.current;

    // Disconnect previous observer if deps changed
    observerRef.current?.disconnect();
    intersectingIds.clear();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.conceptId ?? '';
          if (!id) continue;
          if (entry.isIntersecting) {
            intersectingIds.add(id);
          } else {
            intersectingIds.delete(id);
          }
          changed = true;
        }
        if (!changed) return;

        // Collect ordered IDs from the DOM (only among currently observed cards)
        const cards = root.querySelectorAll(itemSelector);
        const orderedIds: string[] = [];
        for (const card of cards) {
          const id = (card as HTMLElement).dataset.conceptId;
          if (id) orderedIds.push(id);
        }

        const anchorId = selectScrollAnchor(orderedIds, intersectingIds);
        onAnchorChangeRef.current(anchorId);
      },
      {
        root,
        // Detection band: top 50% of the scroll container's visible area.
        // rootMargin: top right bottom left — negative bottom shrinks the
        // detection zone upward, so only cards whose top edge is in the
        // upper half of the viewport qualify as "anchor".
        rootMargin: '0px 0px -50% 0px',
        threshold: 0,
      },
    );

    // Observe existing cards
    const cards = root.querySelectorAll(itemSelector);
    cards.forEach((card) => observerRef.current!.observe(card));

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      intersectingIds.clear();
    };
  }, [scrollRootSelector, itemSelector]);

  /**
   * Call this after new cards are rendered (e.g. after data loads or
   * infinite-scroll pagination) so the observer tracks them.
   */
  const observeCards = useCallback(() => {
    if (!observerRef.current) return;
    const root = document.querySelector(scrollRootSelector);
    if (!root) return;
    const cards = root.querySelectorAll(itemSelector);
    cards.forEach((card) => observerRef.current!.observe(card));
  }, [scrollRootSelector, itemSelector]);

  return { observeCards };
}
