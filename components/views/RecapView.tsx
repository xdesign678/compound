'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRouter } from 'next/navigation';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { pickReviewConcepts, markReviewed } from '@/lib/review-picks';
import { Icon } from '../Icons';
import type { Concept } from '@/lib/types';

const SWIPE_THRESHOLD = 72;
const MAX_Y_DRIFT = 60;

function getBodyPreview(body: string): string {
  const stripped = body
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\n+/g, ' ')
    .trim();
  return stripped.length > 220 ? stripped.slice(0, 220) + '…' : stripped;
}

export function RecapView() {
  const router = useRouter();
  const openConcept = useAppStore((s) => s.openConcept);
  const setTab = useAppStore((s) => s.setTab);

  const allConcepts = useLiveQuery(async () => getDb().concepts.toArray(), []);

  const [cards, setCards] = useState<Concept[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [exitDir, setExitDir] = useState<'left' | 'right'>('left');
  const [mounted, setMounted] = useState(false);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragXRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!allConcepts || !mounted) return;
    setCards(pickReviewConcepts(allConcepts));
    setCurrentIndex(0);
  }, [allConcepts, mounted]);

  const advance = useCallback(
    (dir: 'left' | 'right') => {
      if (exiting) return;
      const card = cards[currentIndex];
      if (card) markReviewed(card.id);
      setExitDir(dir);
      setExiting(true);
      setTimeout(() => {
        setCurrentIndex((i) => i + 1);
        setExiting(false);
        setDragX(0);
        dragXRef.current = 0;
      }, 280);
    },
    [exiting, cards, currentIndex],
  );

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = Math.abs(t.clientY - touchStartRef.current.y);
    if (dy > MAX_Y_DRIFT) {
      touchStartRef.current = null;
      setIsDragging(false);
      setDragX(0);
      dragXRef.current = 0;
      return;
    }
    dragXRef.current = dx;
    setDragX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    const dx = dragXRef.current;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      advance(dx > 0 ? 'right' : 'left');
    } else {
      setDragX(0);
      dragXRef.current = 0;
    }
    touchStartRef.current = null;
  }, [advance]);

  const handleReadMore = useCallback(
    (id: string) => {
      setTab('wiki');
      openConcept(id);
      router.push('/');
    },
    [openConcept, router, setTab],
  );

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

  const isComplete = currentIndex >= cards.length;

  if (isComplete) {
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

  let cardTransform = `translateX(${isDragging ? dragX : 0}px) rotate(${isDragging ? dragX * 0.025 : 0}deg)`;
  let cardOpacity = 1;
  let cardTransition = isDragging
    ? 'none'
    : exiting
      ? 'transform 280ms cubic-bezier(0.4,0,1,1), opacity 280ms'
      : 'transform 200ms cubic-bezier(0.22,1,0.36,1)';

  if (exiting) {
    cardTransform = `translateX(${exitDir === 'left' ? '-130%' : '130%'}) rotate(${exitDir === 'left' ? -18 : 18}deg)`;
    cardOpacity = 0;
  }

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
            className="recap-card recap-card-top"
            style={{ transform: cardTransform, opacity: cardOpacity, transition: cardTransition }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
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
            <p className="recap-card-summary">{currentCard.summary}</p>

            {currentCard.body && (
              <div className="recap-card-body-wrap">
                <p className="recap-card-body-text">{getBodyPreview(currentCard.body)}</p>
              </div>
            )}

            <button className="recap-card-read-more" onClick={() => handleReadMore(currentCard.id)}>
              深入阅读
              <Icon.Send />
            </button>
          </div>
        </div>
      </div>

      <div className="recap-actions">
        <button
          className="recap-next-btn"
          onClick={() => advance('left')}
          disabled={exiting}
          aria-label="下一个概念"
        >
          下一个
        </button>
      </div>
    </div>
  );
}
