'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { hapticLight, hapticSuccess } from '@/lib/haptic';

const EDGE_WIDTH = 36; // px from left edge to start (was 24)
const MIN_DISTANCE = 80; // px to trigger back (raised from 60 to avoid iOS conflict)
const MIN_VELOCITY = 0.3; // px/ms - fast swipe can trigger even below MIN_DISTANCE
const MAX_Y_DRIFT = 100; // px vertical drift tolerance

export function SwipeBack() {
  const back = useAppStore((s) => s.back);
  const detail = useAppStore((s) => s.detail);
  const modalOpen = useAppStore((s) => s.modalOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);

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

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch.clientX <= EDGE_WIDTH) {
        startRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
        hapticLight();
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

      if (dx > 0) {
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
        const endTouch = document.documentElement;
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
