'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PANEL_WIDTH = 280;
const DIVIDER_WIDTH = 4;
const DEFAULT_RATIO = 0.5;

export interface UseResizableReturn {
  primaryWidth: number | null;
  dividerProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
}

/**
 * Hook that provides resizable split-pane behaviour for the desktop layout.
 * Stores the width in a ref during drag (no state churn) and syncs to state
 * only on mouse-up so React can re-render with the final value.
 *
 * The width is applied to the container element as the CSS custom property
 * `--desktop-primary-width` (in px).
 */
export function useResizable(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): UseResizableReturn {
  const [primaryWidth, setPrimaryWidth] = useState<number | null>(null);
  const widthRef = useRef<number | null>(null);

  const dragStateRef = useRef<{
    startX: number;
    startWidth: number;
    startContainerWidth: number;
  } | null>(null);

  // Write the current width to the container's CSS custom property.
  const applyWidth = useCallback(
    (width: number) => {
      const el = containerRef.current;
      if (el) {
        el.style.setProperty('--desktop-primary-width', `${width}px`);
      }
      widthRef.current = width;
    },
    [containerRef],
  );

  // Initialise the split when `enabled` flips to true.
  useEffect(() => {
    if (!enabled) {
      setPrimaryWidth(null);
      widthRef.current = null;
      const el = containerRef.current;
      if (el) {
        el.style.removeProperty('--desktop-primary-width');
      }
      return;
    }

    // Wait a frame so the container has its final dimensions.
    const raf = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      const containerWidth = el.getBoundingClientRect().width - DIVIDER_WIDTH;
      const initial = Math.round(containerWidth * DEFAULT_RATIO);
      const clamped = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(containerWidth - MIN_PANEL_WIDTH, initial),
      );
      applyWidth(clamped);
      setPrimaryWidth(clamped);
    });

    return () => cancelAnimationFrame(raf);
  }, [enabled, containerRef, applyWidth]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      e.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      dragStateRef.current = {
        startX: e.clientX,
        startWidth: widthRef.current ?? Math.round(rect.width * DEFAULT_RATIO),
        startContainerWidth: rect.width,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const drag = dragStateRef.current;
        if (!drag) return;

        const delta = moveEvent.clientX - drag.startX;
        const containerWidth = drag.startContainerWidth - DIVIDER_WIDTH;
        let newWidth = drag.startWidth + delta;
        newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(containerWidth - MIN_PANEL_WIDTH, newWidth));
        applyWidth(newWidth);
      };

      const handleMouseUp = () => {
        const final = widthRef.current;
        if (final !== null) {
          setPrimaryWidth(final);
        }
        dragStateRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [containerRef, enabled, applyWidth],
  );

  return {
    primaryWidth,
    dividerProps: { onMouseDown: handleMouseDown },
  };
}
