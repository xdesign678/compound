'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PANEL_WIDTH = 280;
const DIVIDER_WIDTH = 4;
const DEFAULT_RATIO = 0.5;

export interface UseResizableReturn {
  primaryWidth: number | null;
  dividerProps: {
    role: 'separator';
    tabIndex: number;
    'aria-label': string;
    'aria-orientation': 'vertical';
    'aria-valuemin': number;
    'aria-valuemax': number;
    'aria-valuenow': number | undefined;
    onPointerDown: (event: React.PointerEvent) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
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

  const getBounds = useCallback(() => {
    const width = (containerRef.current?.getBoundingClientRect().width ?? 0) - DIVIDER_WIDTH;
    return {
      min: MIN_PANEL_WIDTH,
      max: Math.max(MIN_PANEL_WIDTH, width - MIN_PANEL_WIDTH),
    };
  }, [containerRef]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      event.preventDefault();

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      event.currentTarget.setPointerCapture(event.pointerId);

      dragStateRef.current = {
        startX: event.clientX,
        startWidth: widthRef.current ?? Math.round(rect.width * DEFAULT_RATIO),
        startContainerWidth: rect.width,
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const drag = dragStateRef.current;
        if (!drag) return;

        const delta = moveEvent.clientX - drag.startX;
        const containerWidth = drag.startContainerWidth - DIVIDER_WIDTH;
        let newWidth = drag.startWidth + delta;
        newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(containerWidth - MIN_PANEL_WIDTH, newWidth));
        applyWidth(newWidth);
      };

      const handlePointerUp = () => {
        const final = widthRef.current;
        if (final !== null) {
          setPrimaryWidth(final);
        }
        dragStateRef.current = null;
        document.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('pointermove', handlePointerMove);
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [containerRef, enabled, applyWidth],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!enabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const bounds = getBounds();
      const step = event.shiftKey ? 40 : 16;
      const current = widthRef.current ?? Math.round((bounds.min + bounds.max) / 2);
      let next = current;
      if (event.key === 'ArrowLeft') next = current - step;
      if (event.key === 'ArrowRight') next = current + step;
      if (event.key === 'Home') next = bounds.min;
      if (event.key === 'End') next = bounds.max;
      next = Math.max(bounds.min, Math.min(bounds.max, next));
      applyWidth(next);
      setPrimaryWidth(next);
    },
    [applyWidth, enabled, getBounds],
  );

  const bounds = getBounds();

  return {
    primaryWidth,
    dividerProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-label': '调整列表与详情面板宽度',
      'aria-orientation': 'vertical',
      'aria-valuemin': bounds.min,
      'aria-valuemax': bounds.max,
      'aria-valuenow': primaryWidth ?? undefined,
      onPointerDown: handlePointerDown,
      onKeyDown: handleKeyDown,
    },
  };
}
