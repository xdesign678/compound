'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { hapticLight, hapticSuccess } from '@/lib/haptic';

const TRIGGER_DISTANCE = 72;   // px pull to trigger refresh
const MAX_PULL = 120;          // visual clamp
const RESISTANCE = 0.45;       // rubber-band feel

interface PullToRefreshProps {
  /** CSS selector for the scroll container (default: .app-main) */
  scrollSelector?: string;
  /** Called when pull-to-refresh is triggered */
  onRefresh?: () => void;
  /** Minimum viewport width to enable (default: 1024, i.e. disabled on desktop) */
  maxWidth?: number;
}

export function PullToRefresh({
  scrollSelector = '.app-main',
  onRefresh,
  maxWidth = 1023,
}: PullToRefreshProps) {
  const [, setTick] = useState(0);
  const distanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const pullingRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const startScrollRef = useRef(0);
  const containerRef = useRef<HTMLElement | null>(null);
  const canPullRef = useRef(false);
  const hasVibratedRef = useRef(false);

  const forceRender = useCallback(() => setTick((t) => t + 1), []);

  const getContainer = useCallback(() => {
    if (!containerRef.current) {
      containerRef.current = document.querySelector<HTMLElement>(scrollSelector);
    }
    return containerRef.current;
  }, [scrollSelector]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!onRefresh) return;

    const isMobile = () => window.innerWidth <= maxWidth;

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile()) return;
      const el = getContainer();
      if (!el) return;
      const scrollTop = el.scrollTop ?? 0;
      if (scrollTop > 2) return; // not at top
      const touch = e.touches[0];
      startYRef.current = touch.clientY;
      startScrollRef.current = scrollTop;
      canPullRef.current = true;
      hasVibratedRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!canPullRef.current || startYRef.current == null) return;
      const touch = e.touches[0];
      const dy = touch.clientY - startYRef.current;
      if (dy < 0) {
        // scrolling up, release pull
        pullingRef.current = false;
        distanceRef.current = 0;
        canPullRef.current = false;
        forceRender();
        return;
      }
      const resisted = Math.min(dy * RESISTANCE, MAX_PULL);
      pullingRef.current = true;
      distanceRef.current = resisted;
      forceRender();
      if (resisted >= TRIGGER_DISTANCE && !hasVibratedRef.current) {
        hasVibratedRef.current = true;
        hapticLight();
      }
    };

    const onTouchEnd = () => {
      if (!canPullRef.current) return;
      canPullRef.current = false;
      pullingRef.current = false;
      if (distanceRef.current >= TRIGGER_DISTANCE && !refreshingRef.current) {
        refreshingRef.current = true;
        hapticSuccess();
        onRefresh();
        // auto-reset after a sensible delay
        window.setTimeout(() => {
          refreshingRef.current = false;
          forceRender();
        }, 600);
      }
      distanceRef.current = 0;
      startYRef.current = null;
      forceRender();
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [getContainer, onRefresh, maxWidth, forceRender]);

  const pulling = pullingRef.current;
  const distance = distanceRef.current;
  const refreshing = refreshingRef.current;

  if (!pulling && !refreshing && distance === 0) return null;

  const progress = Math.min(distance / TRIGGER_DISTANCE, 1);
  const opacity = Math.min(progress * 0.9, 0.9);
  const scale = 0.5 + progress * 0.5;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 45,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        height: `${Math.max(distance, refreshing ? TRIGGER_DISTANCE : 0)}px`,
        transition: pulling ? 'none' : 'height 260ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--bg-button)',
          color: 'var(--text-on-button)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: refreshing ? 1 : opacity,
          transform: `scale(${refreshing ? 1 : scale})`,
          transition: pulling
            ? 'none'
            : 'opacity 200ms ease, transform 200ms ease',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {refreshing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" style={{ transformOrigin: 'center', animation: 'spin 0.8s linear infinite' }} />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${progress * 180}deg)`, transition: 'transform 60ms linear' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>
    </div>
  );
}
