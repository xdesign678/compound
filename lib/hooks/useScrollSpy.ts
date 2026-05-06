import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';

interface UseScrollSpyOptions {
  /** CSS selector for the scroll container. Defaults to '.app-main'. */
  scrollRootSelector?: string;
  /** Threshold (px) above which the search bar collapses. Defaults to 40. */
  collapseThreshold?: number;
  /** Threshold (px) above which the header is considered "scrolled". Defaults to 4. */
  scrolledThreshold?: number;
  /** Optional callback fired with current scrollTop on each scroll frame. */
  onScroll?: (scrollTop: number) => void;
}

/**
 * Shared scroll-spy hook used by WikiView, LibraryView, and SourcesView.
 *
 * Manages the `scrolled` local state and the global `searchCollapsed` store flag
 * based on the scroll position of a container element.
 */
export function useScrollSpy({
  scrollRootSelector = '.app-main',
  collapseThreshold = 40,
  scrolledThreshold = 4,
  onScroll,
}: UseScrollSpyOptions = {}) {
  const setSearchCollapsed = useAppStore((s) => s.setSearchCollapsed);
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
      setSearchCollapsed(y > collapseThreshold);
      pendingY = y;
      if (!raf) raf = requestAnimationFrame(flush);
    };

    handleScroll();
    main.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', handleScroll);
      setSearchCollapsed(false);
      if (raf) cancelAnimationFrame(raf);
      if (pendingY !== null) {
        onScroll?.(pendingY);
      }
    };
  }, [scrollRootSelector, collapseThreshold, scrolledThreshold, setSearchCollapsed, onScroll]);

  return { scrolled };
}
