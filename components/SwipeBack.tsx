'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { hapticLight, hapticSuccess } from '@/lib/haptic';

const EDGE_WIDTH = 36; // px from left edge to start (was 24)
const MIN_DISTANCE = 60; // px to trigger back
const MAX_Y_DRIFT = 100; // px vertical drift tolerance
const INDICATOR_SIZE = 32;

export function SwipeBack() {
  const back = useAppStore((s) => s.back);
  const detail = useAppStore((s) => s.detail);
  const modalOpen = useAppStore((s) => s.modalOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);

  const startRef = useRef<{ x: number; y: number } | null>(null);
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
        startRef.current = { x: touch.clientX, y: touch.clientY };
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
      if (progressRef.current >= 1) {
        hapticSuccess();
        back();
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
        position: 'fixed',
        left: 0,
        top: '50%',
        width: INDICATOR_SIZE,
        height: INDICATOR_SIZE,
        borderRadius: '50%',
        background: 'var(--bg-button)',
        color: 'var(--text-on-button)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0,
        transform: 'translateX(-100%) translateY(-50%) scale(0.6)',
        transition:
          'opacity var(--motion-duration-fast) var(--motion-ease-standard), transform var(--motion-duration-fast) var(--motion-ease-standard)',
        zIndex: 100,
        pointerEvents: 'none',
        boxShadow: 'var(--shadow-md)',
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
