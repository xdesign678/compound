'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { hapticLight, hapticSuccess } from '@/lib/haptic';
import { canStartPullToRefresh } from '@/lib/pull-to-refresh-boundary';
import { useAppStore } from '@/lib/store';

const TRIGGER_DISTANCE = 72; // px pull to trigger refresh
const MAX_PULL = 120; // visual clamp
const RESISTANCE = 0.45; // rubber-band feel
const REFRESH_TIMEOUT = 15000; // 15s timeout for refresh promise
const LEFT_EDGE_ZONE = 36; // px — matches SwipeBack edge width, exclude to avoid conflict
const DIRECTION_LOCK_PX = 10; // minimum total movement before deciding axis
const DIRECTION_RATIO = 1.25; // |dy| must be >= |dx| * this to confirm vertical

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
  const startXRef = useRef<number | null>(null);
  const startScrollRef = useRef(0);
  const containerRef = useRef<HTMLElement | null>(null);
  const canPullRef = useRef(false);
  const axisLockedRef = useRef(false); // true once we've decided vertical vs horizontal
  const isVerticalRef = useRef(false); // true = confirmed downward pull
  const hasVibratedRef = useRef(false);
  const indicatorElRef = useRef<HTMLDivElement>(null);
  const indicatorBallRef = useRef<HTMLDivElement>(null);

  const forceRender = useCallback(() => setTick((t) => t + 1), []);

  /** Directly update indicator DOM for smooth 60fps during pull */
  const updateIndicatorDOM = useCallback(
    (distance: number, pulling: boolean, refreshing: boolean) => {
      const wrapper = indicatorElRef.current;
      const ball = indicatorBallRef.current;
      if (!wrapper || !ball) return;

      const height = Math.max(distance, refreshing ? TRIGGER_DISTANCE : 0);
      wrapper.style.height = `${height}px`;
      wrapper.style.transition = pulling ? 'none' : 'height 260ms cubic-bezier(0.22, 1, 0.36, 1)';
      wrapper.style.display = distance > 0 || refreshing ? 'flex' : 'none';

      const progress = Math.min(distance / TRIGGER_DISTANCE, 1);
      const opacity = refreshing ? 1 : Math.min(progress * 0.9, 0.9);
      const scale = refreshing ? 1 : 0.5 + progress * 0.5;
      ball.style.opacity = String(opacity);
      ball.style.transform = `scale(${scale})`;
      ball.style.transition = pulling ? 'none' : 'opacity 200ms ease, transform 200ms ease';
    },
    [],
  );

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
      const target = e.target as HTMLElement;
      if (!canStartPullToRefresh({ target, root: el })) return;
      const touch = e.touches[0];
      // Exclude left edge zone to avoid conflicting with SwipeBack
      if (touch.clientX <= LEFT_EDGE_ZONE) return;
      const scrollTop = el.scrollTop ?? 0;
      startYRef.current = touch.clientY;
      startXRef.current = touch.clientX;
      startScrollRef.current = scrollTop;
      canPullRef.current = true;
      axisLockedRef.current = false;
      isVerticalRef.current = false;
      hasVibratedRef.current = false;
    };

    const cancelPull = () => {
      canPullRef.current = false;
      axisLockedRef.current = true;
      if (pullingRef.current) {
        pullingRef.current = false;
        distanceRef.current = 0;
        updateIndicatorDOM(0, false, refreshingRef.current);
        forceRender();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!canPullRef.current || startYRef.current == null || startXRef.current == null) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      // Phase 1: direction not yet locked — decide axis
      if (!axisLockedRef.current) {
        const totalDrift = Math.abs(dx) + Math.abs(dy);
        if (totalDrift < DIRECTION_LOCK_PX) return; // not enough movement to decide

        if (Math.abs(dy) >= Math.abs(dx) * DIRECTION_RATIO) {
          // Confirmed vertical (downward)
          axisLockedRef.current = true;
          isVerticalRef.current = true;
        } else if (Math.abs(dx) >= Math.abs(dy) * DIRECTION_RATIO) {
          // Confirmed horizontal — cancel pull-to-refresh entirely
          cancelPull();
          return;
        }
        // Diagonal / undecided — don't hijack yet, keep tracking
        return;
      }

      // Phase 2: axis locked to vertical
      if (!isVerticalRef.current) return;

      if (dy < 0) {
        // scrolling up, release pull
        if (pullingRef.current) {
          pullingRef.current = false;
          distanceRef.current = 0;
          canPullRef.current = false;
          updateIndicatorDOM(0, false, refreshingRef.current);
          forceRender();
        }
        return;
      }

      // Prevent default scroll only after confirming vertical pull
      e.preventDefault();

      const resisted = Math.min(dy * RESISTANCE, MAX_PULL);
      const wasPulling = pullingRef.current;
      pullingRef.current = true;
      distanceRef.current = resisted;

      // Direct DOM update for smooth 60fps — no React re-render
      updateIndicatorDOM(resisted, true, false);

      // Only trigger state update at key thresholds
      if (!wasPulling) {
        forceRender(); // Started pulling — show indicator
      }

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
        // Wait for onRefresh with 15s timeout
        Promise.race([
          Promise.resolve(onRefresh()),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('refresh timeout')), REFRESH_TIMEOUT),
          ),
        ])
          .catch(() => {
            useAppStore
              .getState()
              .showErrorToast('刷新超时，请检查网络后重试', () => onRefresh?.(), '重试');
          })
          .finally(() => {
            refreshingRef.current = false;
            updateIndicatorDOM(0, false, false);
            forceRender();
          });
      }
      distanceRef.current = 0;
      startYRef.current = null;
      updateIndicatorDOM(0, false, refreshingRef.current);
      forceRender();
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
    document.addEventListener('touchcancel', onTouchEnd);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [getContainer, onRefresh, maxWidth, forceRender, updateIndicatorDOM]);

  const pulling = pullingRef.current;
  const distance = distanceRef.current;
  const refreshing = refreshingRef.current;

  if (!pulling && !refreshing && distance === 0) return null;

  const progress = Math.min(distance / TRIGGER_DISTANCE, 1);

  return (
    <div
      ref={indicatorElRef}
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
        ref={indicatorBallRef}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--bg-button)',
          color: 'var(--text-on-button)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: refreshing ? 1 : Math.min(progress * 0.9, 0.9),
          transform: `scale(${refreshing ? 1 : 0.5 + progress * 0.5})`,
          transition: pulling ? 'none' : 'opacity 200ms ease, transform 200ms ease',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        {refreshing ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path
              d="M21 12a9 9 0 1 1-6.219-8.56"
              style={{ transformOrigin: 'center', animation: 'spin 0.8s linear infinite' }}
            />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: `rotate(${progress * 180}deg)`,
              transition: 'transform 60ms linear',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>
    </div>
  );
}
