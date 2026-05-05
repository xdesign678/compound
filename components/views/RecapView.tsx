'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { ensureConceptsHydrated } from '@/lib/cloud-sync';
import { formatConceptBodyForDisplay } from '@/lib/concept-body-format';
import { pickReviewConcepts, markReviewed } from '@/lib/review-picks';
import { Icon } from '../Icons';
import { Prose } from '../Prose';
import type { Concept } from '@/lib/types';

const SWIPE_THRESHOLD = 64;
const EXIT_DURATION_MS = 320;
const SPRING_DURATION_MS = 360;

export function RecapView() {
  const router = useRouter();
  const openConcept = useAppStore((s) => s.openConcept);
  const setTab = useAppStore((s) => s.setTab);

  const allConcepts = useLiveQuery(async () => getDb().concepts.toArray(), []);

  const [cards, setCards] = useState<Concept[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mounted, setMounted] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const dragXRef = useRef(0);
  const rafRef = useRef(0);
  const animatingRef = useRef(false);
  const pickedIdsRef = useRef<string[] | null>(null);
  const hydrationAttemptsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

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
    let isHorizontal = false;

    const onTouchStart = (e: TouchEvent) => {
      if (animatingRef.current) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      isTracking = true;
      isHorizontal = false;
      dragXRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isTracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!isHorizontal) {
        const totalDrift = Math.abs(dx) + Math.abs(dy);
        if (totalDrift < 10) return; // not enough to decide yet

        // Use angle threshold + lock axis (30° = tan(30°) ≈ 0.577)
        const angle = Math.abs(dy) / (Math.abs(dx) + Math.abs(dy) + 0.001);
        if (angle < 0.5) {
          isHorizontal = true;
        } else {
          isTracking = false;
          return;
        }
      }

      if (isHorizontal) {
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
      const wasHorizontal = isHorizontal;
      isTracking = false;
      isHorizontal = false;

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
      isHorizontal = false;
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

  const handleReadMore = useCallback(
    (id: string) => {
      setTab('wiki');
      openConcept(id);
      router.push('/');
    },
    [openConcept, router, setTab],
  );

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
    <div className="recap-root">
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
    </div>
  );
}
