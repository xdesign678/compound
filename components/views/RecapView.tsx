'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { formatConceptBodyForDisplay } from '@/lib/concept-body-format';
import { pickReviewConcepts, markReviewed } from '@/lib/review-picks';
import { Icon } from '../Icons';
import { Prose } from '../Prose';
import type { Concept } from '@/lib/types';

const SWIPE_THRESHOLD = 64;
const MAX_Y_DRIFT = 80;
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
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const dragXRef = useRef(0);
  const isDraggingRef = useRef(false);
  const rafRef = useRef(0);
  const animatingRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!allConcepts || !mounted) return;
    setCards(pickReviewConcepts(allConcepts));
    setCurrentIndex(0);
  }, [allConcepts, mounted]);

  // ---- direct DOM manipulation for drag (no setState during move) ----

  const applyCardTransform = useCallback((dx: number, rotation = dx * 0.015) => {
    const el = cardRef.current;
    if (!el) return;
    const scale = 1 - Math.min(Math.abs(dx), 200) / 2000;
    el.style.transform = `translateX(${dx}px) rotate(${rotation}deg) scale(${scale})`;
    el.style.transition = 'none';
  }, []);

  const animateExit = useCallback((dir: 'left' | 'right') => {
    const el = cardRef.current;
    if (!el) return;
    animatingRef.current = true;
    el.style.transition = `transform ${EXIT_DURATION_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${EXIT_DURATION_MS}ms ease`;
    el.style.transform = `translateX(${dir === 'left' ? '-130%' : '130%'}) rotate(${dir === 'left' ? -14 : 14}deg) scale(0.92)`;
    el.style.opacity = '0';

    setTimeout(() => {
      animatingRef.current = false;
      dragXRef.current = 0;
      setCurrentIndex((i) => i + 1);
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
      const card = cards[currentIndex];
      if (card) markReviewed(card.id);
      animateExit(dir);
    },
    [cards, currentIndex, animateExit],
  );

  // ---- touch handlers ----

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (animatingRef.current) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    isDraggingRef.current = true;
    dragXRef.current = 0;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDraggingRef.current || !touchStartRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartRef.current.x;
      const dy = Math.abs(t.clientY - touchStartRef.current.y);

      // If vertical scroll intent, cancel drag
      if (dy > MAX_Y_DRIFT && Math.abs(dx) < 10) {
        isDraggingRef.current = false;
        touchStartRef.current = null;
        applyCardTransform(0, 0);
        return;
      }

      // Apply damping: the further you drag, the more resistance
      const damped = dx * 0.85;
      dragXRef.current = damped;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyCardTransform(damped, damped * 0.015);
      });
    },
    [applyCardTransform],
  );

  const handleTouchEnd = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    isDraggingRef.current = false;
    touchStartRef.current = null;

    const dx = dragXRef.current;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      advance(dx > 0 ? 'right' : 'left');
    } else {
      animateSpring();
    }
  }, [advance, animateSpring]);

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

          <div
            ref={cardRef}
            className="recap-card recap-card-top"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            key={currentCard.id}
          >
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

              {/* full body — mirrors ConceptDetail prose, scrollable inside card */}
              {currentCard.body && (
                <Prose
                  markdown={formatConceptBodyForDisplay(currentCard.body)}
                  className="recap-card-body-prose"
                />
              )}

              <div className="recap-swipe-hint" aria-hidden="true">
                <span className="recap-swipe-arrow">←</span>
                <span>左右滑动切换</span>
                <span className="recap-swipe-arrow">→</span>
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
