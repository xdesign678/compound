'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { ensureConceptsHydrated } from '@/lib/cloud-sync';
import { formatConceptBodyForDisplay } from '@/lib/concept-body-format';
import { pickReviewConcepts, markReviewed } from '@/lib/review-picks';
import { resolveRecapGestureAxis, type RecapGestureAxis } from '@/lib/recap-gesture-lock';
import { DESKTOP_LAYOUT_MIN_WIDTH } from '@/lib/responsive';
import { Icon } from '../Icons';
import { Prose } from '../Prose';
import type { Concept } from '@/lib/types';

const ConceptDetail = dynamic(
  () => import('./ConceptDetail').then((m) => ({ default: m.ConceptDetail })),
  { ssr: false },
);

const SWIPE_THRESHOLD = 64;
const EXIT_DURATION_MS = 320;
const SPRING_DURATION_MS = 360;
const PEEK_TRANSITION_MS = 320;

export function RecapView() {
  const router = useRouter();
  const openConcept = useAppStore((s) => s.openConcept);
  const setTab = useAppStore((s) => s.setTab);
  const detail = useAppStore((s) => s.detail);
  const back = useAppStore((s) => s.back);

  const allConcepts = useLiveQuery(async () => getDb().concepts.toArray(), []);

  const [cards, setCards] = useState<Concept[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [peekConceptId, setPeekConceptId] = useState<string | null>(null);
  const [peekVisible, setPeekVisible] = useState(false);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragXRef = useRef(0);
  const rafRef = useRef(0);
  const animatingRef = useRef(false);
  const pickedIdsRef = useRef<string[] | null>(null);
  const hydrationAttemptsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Detect web/desktop viewport so we can swap "深入阅读" navigation for an inline drawer.
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_LAYOUT_MIN_WIDTH}px)`);
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    return () => {
      if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    };
  }, []);

  // Related-concept chips inside ConceptDetail call the global `openConcept`
  // store action, which sets `detail`. On /recap nothing renders `detail`, so
  // we intercept it here: when the peek drawer is showing a concept and the
  // store's detail changes to a different concept, swap the peek to that one
  // and clear the global detail again (without leaving stale history state).
  useEffect(() => {
    if (!peekConceptId) return;
    if (!detail || detail.type !== 'concept') return;
    if (detail.id === peekConceptId) return;
    setPeekConceptId(detail.id);
    back();
  }, [detail, peekConceptId, back]);

  useEffect(() => {
    if (!allConcepts || !mounted) return;
    const conceptsById = new Map(allConcepts.map((concept) => [concept.id, concept]));

    if (!pickedIdsRef.current || (pickedIdsRef.current.length === 0 && allConcepts.length > 0)) {
      const picked = pickReviewConcepts(allConcepts);
      pickedIdsRef.current = picked.map((concept) => concept.id);
      setCards(picked);
      setCurrentIndex(0);
      return;
    }

    setCards((currentCards) =>
      currentCards.map((concept) => conceptsById.get(concept.id) ?? concept),
    );
  }, [allConcepts, mounted]);

  useEffect(() => {
    if (cards.length === 0) return;

    const hydrationAttempts = hydrationAttemptsRef.current;
    const idsToHydrate = cards
      .filter(
        (concept) =>
          (concept.contentStatus !== 'full' || !(concept.body || '').trim()) &&
          !hydrationAttempts.has(concept.id),
      )
      .map((concept) => concept.id);

    if (idsToHydrate.length === 0) return;

    idsToHydrate.forEach((id) => hydrationAttempts.add(id));

    let cancelled = false;
    let settled = false;
    void ensureConceptsHydrated(idsToHydrate)
      .then((hydratedConcepts) => {
        if (cancelled || hydratedConcepts.length === 0) return;
        const hydratedById = new Map(hydratedConcepts.map((concept) => [concept.id, concept]));
        setCards((currentCards) =>
          currentCards.map((concept) => hydratedById.get(concept.id) ?? concept),
        );
      })
      .catch((err) => {
        console.warn('[recap] concept hydration failed:', err);
      })
      .finally(() => {
        settled = true;
      });

    return () => {
      cancelled = true;
      if (!settled) {
        idsToHydrate.forEach((id) => hydrationAttempts.delete(id));
      }
    };
  }, [cards]);

  // ---- direct DOM manipulation for drag (no setState during move) ----

  const applyCardTransform = useCallback((dx: number, rotation = dx * 0.015) => {
    const el = cardRef.current;
    if (!el) return;
    const scale = 1 - Math.min(Math.abs(dx), 200) / 2000;
    el.style.transform = `translateX(${dx}px) rotate(${rotation}deg) scale(${scale})`;
    el.style.transition = 'none';
  }, []);

  const animateExit = useCallback((dir: 'left' | 'right', delta = 1) => {
    const el = cardRef.current;
    if (!el) return;
    animatingRef.current = true;
    el.style.transition = `transform ${EXIT_DURATION_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${EXIT_DURATION_MS}ms ease`;
    el.style.transform = `translateX(${dir === 'left' ? '-130%' : '130%'}) rotate(${dir === 'left' ? -14 : 14}deg) scale(0.92)`;
    el.style.opacity = '0';

    setTimeout(() => {
      animatingRef.current = false;
      dragXRef.current = 0;
      setCurrentIndex((i) => Math.max(0, i + delta));
    }, EXIT_DURATION_MS);
  }, []);

  const animateSpring = useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    animatingRef.current = true;
    el.style.transition = `transform ${SPRING_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.transform = 'translateX(0) rotate(0deg) scale(1)';

    const onEnd = () => {
      animatingRef.current = false;
      dragXRef.current = 0;
      el.removeEventListener('transitionend', onEnd);
    };
    el.addEventListener('transitionend', onEnd);
  }, []);

  const advance = useCallback(
    (dir: 'left' | 'right') => {
      if (animatingRef.current) return;
      if (dir === 'left') {
        // swipe left = go forward and mark reviewed
        const card = cards[currentIndex];
        if (card) markReviewed(card.id);
        animateExit('left', 1);
      } else {
        // swipe right = go back
        if (currentIndex <= 0) {
          animateSpring();
          return;
        }
        animateExit('right', -1);
      }
    },
    [cards, currentIndex, animateExit, animateSpring],
  );

  // ---- native touch events on the card ----
  // Using native listeners so we can call preventDefault() during horizontal
  // swipes (passive:false) while letting vertical scroll pass through.
  useEffect(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    let startX = 0;
    let startY = 0;
    let isTracking = false;
    let lockedAxis: RecapGestureAxis | null = null;
    let moveFrameCount = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (animatingRef.current) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      isTracking = true;
      lockedAxis = null;
      moveFrameCount = 0;
      dragXRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isTracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!lockedAxis) {
        const totalDrift = Math.abs(dx) + Math.abs(dy);
        if (totalDrift < 10) return; // not enough to decide yet
        moveFrameCount += 1;

        lockedAxis = resolveRecapGestureAxis({ dx, dy, frameCount: moveFrameCount });
        if (!lockedAxis) return;
        if (lockedAxis === 'vertical') {
          isTracking = false;
          return;
        }
      }

      if (lockedAxis === 'horizontal') {
        e.preventDefault();
        const damped = dx * 0.85;
        dragXRef.current = damped;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          applyCardTransform(damped, damped * 0.015);
          // Disable pointer events during drag to prevent click-through
          if (cardRef.current) cardRef.current.style.pointerEvents = 'none';
        });
      }
    };

    const onTouchEnd = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Restore pointer events after drag
      if (cardRef.current) cardRef.current.style.pointerEvents = '';
      const wasHorizontal = lockedAxis === 'horizontal';
      isTracking = false;
      lockedAxis = null;
      moveFrameCount = 0;

      if (wasHorizontal) {
        const dx = dragXRef.current;
        if (Math.abs(dx) >= SWIPE_THRESHOLD) {
          advance(dx > 0 ? 'right' : 'left');
        } else {
          animateSpring();
        }
      }
    };

    const onTouchCancel = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      isTracking = false;
      lockedAxis = null;
      moveFrameCount = 0;
      if (dragXRef.current !== 0) {
        animateSpring();
      }
    };

    cardEl.addEventListener('touchstart', onTouchStart, { passive: true });
    cardEl.addEventListener('touchmove', onTouchMove, { passive: false });
    cardEl.addEventListener('touchend', onTouchEnd, { passive: true });
    cardEl.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      cardEl.removeEventListener('touchstart', onTouchStart);
      cardEl.removeEventListener('touchmove', onTouchMove);
      cardEl.removeEventListener('touchend', onTouchEnd);
      cardEl.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [applyCardTransform, animateSpring, advance]);

  // ---- pointer (mouse) events for desktop drag ----
  useEffect(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;

    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let lockedAxis: RecapGestureAxis | null = null;
    let moveFrameCount = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Only handle mouse; touch is handled above via touch events
      if (e.pointerType !== 'mouse') return;
      if (animatingRef.current) return;
      // Ignore clicks on interactive elements (buttons, links)
      const target = e.target as HTMLElement;
      if (target.closest('button, a, [role="button"]')) return;

      startX = e.clientX;
      startY = e.clientY;
      isDragging = true;
      lockedAxis = null;
      moveFrameCount = 0;
      dragXRef.current = 0;
      cardEl.setPointerCapture(e.pointerId);
      cardEl.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!lockedAxis) {
        const totalDrift = Math.abs(dx) + Math.abs(dy);
        if (totalDrift < 10) return;
        moveFrameCount += 1;

        lockedAxis = resolveRecapGestureAxis({ dx, dy, frameCount: moveFrameCount });
        if (!lockedAxis) return;
        if (lockedAxis === 'vertical') {
          isDragging = false;
          cardEl.style.cursor = 'grab';
          return;
        }
      }

      if (lockedAxis === 'horizontal') {
        e.preventDefault();
        const damped = dx * 0.85;
        dragXRef.current = damped;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          applyCardTransform(damped, damped * 0.015);
        });
      }
    };

    const onPointerUp = (_e: PointerEvent) => {
      if (!isDragging) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      cardEl.style.cursor = 'grab';
      const wasHorizontal = lockedAxis === 'horizontal';
      isDragging = false;
      lockedAxis = null;
      moveFrameCount = 0;

      if (wasHorizontal) {
        const dx = dragXRef.current;
        if (Math.abs(dx) >= SWIPE_THRESHOLD) {
          advance(dx > 0 ? 'right' : 'left');
        } else {
          animateSpring();
        }
      }
    };

    cardEl.addEventListener('pointerdown', onPointerDown);
    cardEl.addEventListener('pointermove', onPointerMove);
    cardEl.addEventListener('pointerup', onPointerUp);
    cardEl.addEventListener('pointercancel', onPointerUp);

    return () => {
      cardEl.removeEventListener('pointerdown', onPointerDown);
      cardEl.removeEventListener('pointermove', onPointerMove);
      cardEl.removeEventListener('pointerup', onPointerUp);
      cardEl.removeEventListener('pointercancel', onPointerUp);
    };
  }, [applyCardTransform, animateSpring, advance]);

  const closePeek = useCallback(() => {
    setPeekVisible(false);
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => {
      setPeekConceptId(null);
      peekTimerRef.current = null;
    }, PEEK_TRANSITION_MS);
  }, []);

  const handleReadMore = useCallback(
    (id: string) => {
      // On web, slide the concept detail in as a side drawer instead of
      // navigating away — keeps the swipe deck in place behind the overlay.
      if (isDesktop) {
        if (peekTimerRef.current) {
          clearTimeout(peekTimerRef.current);
          peekTimerRef.current = null;
        }
        setPeekConceptId(id);
        requestAnimationFrame(() => setPeekVisible(true));
        return;
      }
      setTab('wiki');
      openConcept(id);
      router.push('/');
    },
    [isDesktop, openConcept, router, setTab],
  );

  // ---- keyboard navigation for desktop (global listener) ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (animatingRef.current) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      if (e.key === 'Escape' && peekConceptId) {
        e.preventDefault();
        closePeek();
        return;
      }
      // While the peek drawer is open, leave arrow keys alone so users can
      // scroll inside the detail without flipping cards behind it.
      if (peekConceptId) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        advance('left');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        advance('right');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [advance, peekConceptId, closePeek]);

  // ---- render helpers ----

  if (!mounted || !allConcepts) {
    return (
      <div className="recap-root">
        <div className="recap-state-screen">
          <p className="recap-state-body">加载中…</p>
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="recap-root">
        <header className="recap-header">
          <button className="recap-back-btn" onClick={() => router.back()} aria-label="返回">
            <Icon.Back />
          </button>
          <span className="recap-header-title">今日复盘</span>
        </header>
        <div className="recap-state-screen">
          <div className="recap-state-icon">
            <Icon.Sparkle />
          </div>
          <h3 className="recap-state-heading">暂无待复盘内容</h3>
          <p className="recap-state-body">先添加一些资料，让 AI 编译成概念后就可以在这里复盘了。</p>
          <button className="modal-btn" onClick={() => router.push('/')}>
            回到主页
          </button>
        </div>
      </div>
    );
  }

  if (currentIndex >= cards.length) {
    return (
      <div className="recap-root">
        <header className="recap-header">
          <button className="recap-back-btn" onClick={() => router.push('/')} aria-label="返回">
            <Icon.Back />
          </button>
          <span className="recap-header-title">今日复盘</span>
        </header>
        <div className="recap-state-screen">
          <div className="recap-state-icon">
            <Icon.Lint />
          </div>
          <h3 className="recap-state-heading">本次复盘完成</h3>
          <p className="recap-state-body">共复盘了 {cards.length} 个概念，明天再来刷新一批。</p>
          <button className="modal-btn" onClick={() => router.push('/')}>
            回到主页
          </button>
        </div>
      </div>
    );
  }

  const currentCard = cards[currentIndex];
  const nextCard = cards[currentIndex + 1];
  const nextNextCard = cards[currentIndex + 2];
  const currentCardMarkdown = (currentCard.body || '').trim() || (currentCard.summary || '').trim();

  return (
    <div className="recap-root" ref={containerRef} tabIndex={-1}>
      <header className="recap-header">
        <button className="recap-back-btn" onClick={() => router.push('/')} aria-label="返回">
          <Icon.Back />
        </button>
        <span className="recap-header-title">今日复盘</span>
        <span className="recap-header-progress">
          {currentIndex + 1} / {cards.length}
        </span>
      </header>

      <div className="recap-stack-area">
        <div className="recap-stack">
          {nextNextCard && <div className="recap-card recap-card-ghost-2" aria-hidden="true" />}
          {nextCard && <div className="recap-card recap-card-ghost-1" aria-hidden="true" />}

          <div ref={cardRef} className="recap-card recap-card-top" key={currentCard.id}>
            <div className="recap-card-scroll">
              {/* fixed header zone */}
              {currentCard.categories && currentCard.categories.length > 0 && (
                <div className="recap-card-tags">
                  {currentCard.categories.slice(0, 3).map((cat) => (
                    <span key={`${cat.primary}-${cat.secondary ?? ''}`} className="recap-card-tag">
                      {cat.secondary || cat.primary}
                    </span>
                  ))}
                </div>
              )}

              <h2 className="recap-card-title">{currentCard.title}</h2>

              {/* full body — reuses ConceptDetail prose verbatim, scrollable inside card */}
              <div className="recap-card-body-shell">
                {currentCardMarkdown ? (
                  <Prose
                    markdown={formatConceptBodyForDisplay(currentCardMarkdown)}
                    className="concept-body-prose"
                  />
                ) : (
                  <p className="recap-card-empty">正文同步中...</p>
                )}
              </div>

              <div className="recap-card-footer">
                <button
                  className="recap-card-read-more"
                  onClick={() => handleReadMore(currentCard.id)}
                >
                  深入阅读
                  <Icon.Send />
                </button>
                <span className="recap-card-meta">
                  <Icon.Link />
                  {currentCard.related.length} 链接
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {peekConceptId && (
        <div
          className={`library-detail-overlay recap-peek-overlay${peekVisible ? ' is-open' : ''}`}
          aria-hidden={!peekVisible}
          onClick={closePeek}
        >
          <div
            className="library-detail-modal recap-peek-modal"
            role="dialog"
            aria-modal="true"
            aria-label="概念详情"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="library-detail-modal-close" onClick={closePeek} aria-label="关闭">
              ✕
            </button>
            <div className="library-detail-modal-scroll">
              <ConceptDetail id={peekConceptId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
