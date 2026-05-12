'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { hapticLight, hapticSuccess } from '@/lib/haptic';

const DEFAULT_EDGE_WIDTH = 36; // px from left edge to start
const IOS_EDGE_WIDTH = 20; // Reduced to avoid iOS native back gesture conflict
const MIN_DISTANCE = 80; // px to trigger back (raised from 60 to avoid iOS conflict)
const MAX_Y_DRIFT = 100; // px vertical drift tolerance
const VERTICAL_CANCEL_RATIO = 0.8; // if dy > dx * ratio, it's more vertical than horizontal — cancel

/** Detect iOS Safari (non-standalone PWA) where system back gesture conflicts */
function getIsIOSSafariNonStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const isIOS = /iPhone|iPad/.test(navigator.userAgent);
  const isStandalone = !!(window.navigator as any).standalone;
  return isIOS && !isStandalone;
}

export function SwipeBack() {
  const back = useAppStore((s) => s.back);
  const detail = useAppStore((s) => s.detail);
  const modalOpen = useAppStore((s) => s.modalOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const hasHapticRef = useRef(false);

  const canSwipe = detail && !modalOpen && !settingsOpen;

  const updateIndicator = useCallback((progress: number) => {
    const el = indicatorRef.current;
    if (!el) return;
    progressRef.current = progress;
    if (progress <= 0) {
      el.style.opacity = '0';
      el.style.transform = `translateX(-100%) translateY(-50%) scale(0.6)`;
      return;
    }
    const clamped = Math.min(progress, 1);
    el.style.opacity = String(clamped * 0.9);
    el.style.transform = `translateX(${clamped * 12}px) translateY(-50%) scale(${0.6 + clamped * 0.4})`;
  }, []);

  useEffect(() => {
    if (!canSwipe) {
      updateIndicator(0);
      return;
    }

    const isIOSSafari = getIsIOSSafariNonStandalone();
    const edgeWidth = isIOSSafari ? IOS_EDGE_WIDTH : DEFAULT_EDGE_WIDTH;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX <= edgeWidth) {
        // Don't track if touch starts on a RecapView swipe card
        const target = e.target as HTMLElement;
        if (target.closest('.recap-card')) return;
        startRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
        hasHapticRef.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startRef.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startRef.current.x;
      const dy = Math.abs(touch.clientY - startRef.current.y);

      // Cancel if vertical drift is too large
      if (dy > MAX_Y_DRIFT) {
        startRef.current = null;
        updateIndicator(0);
        return;
      }

      // Cancel if the gesture is more vertical than horizontal
      // (e.g. diagonal down-left or down-right from edge)
      if (dx <= 0 && dy > Math.abs(dx) * VERTICAL_CANCEL_RATIO) {
        startRef.current = null;
        updateIndicator(0);
        return;
      }

      if (dx > 0) {
        // Cancel if vertical component rivals horizontal (near-diagonal)
        if (dy > dx * VERTICAL_CANCEL_RATIO) {
          startRef.current = null;
          updateIndicator(0);
          return;
        }
        // Confirm horizontal swipe direction — fire haptic once
        if (!hasHapticRef.current && dx > 10) {
          hasHapticRef.current = true;
          hapticLight();
        }
        updateIndicator(dx / MIN_DISTANCE);
      }
    };

    const onTouchEnd = () => {
      const start = startRef.current;
      if (progressRef.current >= 1) {
        hapticSuccess();
        back();
      } else if (start) {
        // Velocity-based trigger: fast swipe even below threshold
        const dt = Date.now() - start.t;
        // velocity-based trigger using elapsed time
        // If we have a recent start and fast movement, trigger
        if (dt > 0 && dt < 400 && progressRef.current >= 0.5) {
          hapticSuccess();
          back();
        }
      }
      startRef.current = null;
      updateIndicator(0);
    };

    const onTouchCancel = () => {
      startRef.current = null;
      updateIndicator(0);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchCancel);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [canSwipe, back, updateIndicator]);

  return (
    <div
      ref={indicatorRef}
      className="swipe-back-indicator"
      style={{
        opacity: 0,
        transform: 'translateX(-100%) translateY(-50%) scale(0.6)',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </div>
  );
}
