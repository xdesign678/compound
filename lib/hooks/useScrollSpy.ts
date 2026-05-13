import { useState, useEffect } from 'react';

interface UseScrollSpyOptions {
  /** CSS selector for the scroll container. Defaults to '.app-main'. */
  scrollRootSelector?: string;
  /** Threshold (px) above which the header is considered "scrolled". Defaults to 4. */
  scrolledThreshold?: number;
  /** Optional callback fired with current scrollTop on each scroll frame. */
  onScroll?: (scrollTop: number) => void;
}

/**
 * Shared scroll-spy hook used by WikiView, LibraryView, and SourcesView.
 *
 * Manages the `scrolled` local state based on the scroll position of a container element.
 */
export function useScrollSpy({
  scrollRootSelector = '.app-main',
  scrolledThreshold = 4,
  onScroll,
}: UseScrollSpyOptions = {}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const main = document.querySelector(scrollRootSelector) as HTMLElement | null;
    if (!main) return;

    let raf = 0;
    let pendingY: number | null = null;

    const flush = () => {
      raf = 0;
      if (pendingY !== null) {
        onScroll?.(pendingY);
        pendingY = null;
      }
    };

    const handleScroll = () => {
      const y = main.scrollTop;
      setScrolled(y > scrolledThreshold);
      pendingY = y;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    handleScroll();
    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', handleScroll);
      if (raf) cancelAnimationFrame(raf);
      if (pendingY !== null) {
        onScroll?.(pendingY);
      }
    };
  }, [scrollRootSelector, scrolledThreshold, onScroll]);

  return { scrolled };
}
