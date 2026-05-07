'use client';

import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_POPOVER_HEIGHT = 44;
const DEFAULT_EDGE_PADDING = 8;

export interface SelectionPopoverState {
  visible: boolean;
  top: number;
  left: number;
  text: string;
}

interface UseSelectionPopoverOptions {
  /** The container element ref to check selection within */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Minimum text length to show the popover */
  minLength?: number;
  /** Called when the popover should be dismissed */
  onDismiss: () => void;
  /** Called when the popover state changes */
  onChange: (state: SelectionPopoverState) => void;
}

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

/**
 * Shared hook for selection-based popovers (ConceptDetail / SourceDetail).
 * Ensures only one instance is active at a time (desktop dual-pane).
 */
let activeInstanceId: symbol | null = null;

export function useSelectionPopover({
  containerRef,
  minLength = 2,
  onDismiss,
  onChange,
}: UseSelectionPopoverOptions) {
  const instanceId = useRef(Symbol('selection-popover'));
  const suppressDismissRef = useRef(false);

  const dismiss = useCallback(() => {
    if (suppressDismissRef.current) return;
    if (activeInstanceId === instanceId.current) {
      activeInstanceId = null;
    }
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Capture ref value at effect time per react-hooks/exhaustive-deps
    const currentInstanceId = instanceId.current;

    const updateFromSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const text = sel.toString().trim();
      if (text.length < minLength) return;
      if (!container.contains(range.commonAncestorContainer)) return;

      // Claim ownership
      activeInstanceId = currentInstanceId;

      const rect = range.getBoundingClientRect();
      const viewportBottom = getVisibleViewportBottom(window) + window.scrollY;
      onChange({
        visible: true,
        top: clampPopoverTopToVisibleViewport({
          desiredTop: rect.top + window.scrollY - DEFAULT_EDGE_PADDING,
          viewportBottom,
        }),
        left: rect.left + rect.width / 2,
        text,
      });
    };

    const handlePointerUp = () => {
      // Small delay to let the browser finalize selection
      window.setTimeout(updateFromSelection, 10);
    };

    const handleSelectionChange = () => {
      if (suppressDismissRef.current) return;
      if (activeInstanceId !== null && activeInstanceId !== currentInstanceId) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        dismiss();
      }
    };

    const handleScroll = () => dismiss();
    const handleViewportChange = () => {
      window.setTimeout(updateFromSelection, 10);
    };

    document.addEventListener('mouseup', handlePointerUp);
    document.addEventListener('touchend', handlePointerUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);

    return () => {
      document.removeEventListener('mouseup', handlePointerUp);
      document.removeEventListener('touchend', handlePointerUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      // Capture current instance ID at cleanup time
      if (activeInstanceId === currentInstanceId) {
        activeInstanceId = null;
      }
    };
  }, [containerRef, minLength, dismiss, onChange]);

  return { suppressDismissRef };
}
