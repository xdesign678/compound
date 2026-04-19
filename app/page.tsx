'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { SwipeBack } from '@/components/SwipeBack';
import { Icon } from '@/components/Icons';

const IngestModal = dynamic(() => import('@/components/IngestModal').then(m => ({ default: m.IngestModal })), { ssr: false });
const SettingsDrawer = dynamic(() => import('@/components/SettingsDrawer').then(m => ({ default: m.SettingsDrawer })), { ssr: false });
const WikiView = dynamic(() => import('@/components/views/WikiView').then(m => ({ default: m.WikiView })), { ssr: false });
const SourcesView = dynamic(() => import('@/components/views/SourcesView').then(m => ({ default: m.SourcesView })), { ssr: false });
const AskView = dynamic(() => import('@/components/views/AskView').then(m => ({ default: m.AskView })), { ssr: false });
const ActivityView = dynamic(() => import('@/components/views/ActivityView').then(m => ({ default: m.ActivityView })), { ssr: false });
const ConceptDetail = dynamic(() => import('@/components/views/ConceptDetail').then(m => ({ default: m.ConceptDetail })), { ssr: false });
const SourceDetail = dynamic(() => import('@/components/views/SourceDetail').then(m => ({ default: m.SourceDetail })), { ssr: false });

export default function Page() {
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const openModal = useAppStore((s) => s.openModal);

  // Only render dexie-driven content after client mount to avoid SSR/CSR mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const conceptCount = useLiveQuery(
    async () => (mounted ? getDb().concepts.count() : undefined),
    [mounted]
  );
  const sourceCount = useLiveQuery(
    async () => (mounted ? getDb().sources.count() : undefined),
    [mounted]
  );
  const linkCount = useLiveQuery(
    async () => {
      if (!mounted) return undefined;
      const all = await getDb().concepts.toArray();
      return all.reduce((s, c) => s + c.related.length, 0);
    },
    [mounted]
  );

  // Auto-seed on first run (no onboarding screen)
  const seedingRef = useRef(false);
  useEffect(() => {
    if (!mounted || conceptCount === undefined || sourceCount === undefined) return;
    if (seedingRef.current) return;
    if (localStorage.getItem('compound_seeded')) return;
    if (conceptCount > 0 || sourceCount > 0) return;
    seedingRef.current = true;
    (async () => {
      const db = getDb();
      await db.sources.bulkPut(SEED_SOURCES);
      await db.concepts.bulkPut(SEED_CONCEPTS);
      await db.activity.bulkPut(SEED_ACTIVITY);
      localStorage.setItem('compound_seeded', '1');
    })();
  }, [mounted, conceptCount, sourceCount]);

  const ready = mounted && conceptCount !== undefined && sourceCount !== undefined;
  const modalOpen = useAppStore((s) => s.modalOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const showFab = !detail && (tab === 'wiki' || tab === 'sources');

  return (
    <div className="app-shell">
      <Toast />
      <SwipeBack />
      <Header conceptCount={conceptCount ?? 0} sourceCount={sourceCount ?? 0} linkCount={linkCount ?? 0} />

      <main className="app-main">
        {!ready ? (
          <div className="loading-skeleton" aria-label="正在加载..." aria-busy="true">
            <div className="skeleton skeleton-header" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
            <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
          </div>
        ) : detail ? (
          <div key={detail.id} className="detail-view">
            {detail.type === 'concept' ? (
              <ConceptDetail id={detail.id} />
            ) : (
              <SourceDetail id={detail.id} />
            )}
          </div>
        ) : tab === 'wiki' ? (
          <div key="wiki" className="tab-view"><WikiView /></div>
        ) : tab === 'sources' ? (
          <div key="sources" className="tab-view"><SourcesView /></div>
        ) : tab === 'ask' ? (
          <div key="ask" className="tab-view ask-tab"><AskView /></div>
        ) : (
          <div key="activity" className="tab-view"><ActivityView /></div>
        )}
      </main>

      {showFab && ready && (
        <button className="fab" onClick={openModal} aria-label="添加资料">
          <Icon.Plus />
        </button>
      )}

      <TabBar />
      {modalOpen && <IngestModal />}
      {settingsOpen && <SettingsDrawer />}
    </div>
  );
}
