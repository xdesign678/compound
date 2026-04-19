'use client';

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { IngestModal } from '@/components/IngestModal';
import { SettingsDrawer } from '@/components/SettingsDrawer';
import { Icon } from '@/components/Icons';

import { WikiView } from '@/components/views/WikiView';
import { SourcesView } from '@/components/views/SourcesView';
import { AskView } from '@/components/views/AskView';
import { ActivityView } from '@/components/views/ActivityView';
import { ConceptDetail } from '@/components/views/ConceptDetail';
import { SourceDetail } from '@/components/views/SourceDetail';

export default function Page() {
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const openModal = useAppStore((s) => s.openModal);

  // Only render dexie-driven content after client mount to avoid SSR/CSR mismatch
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const concepts = useLiveQuery(
    async () => (mounted ? getDb().concepts.toArray() : undefined),
    [mounted]
  );
  const sources = useLiveQuery(
    async () => (mounted ? getDb().sources.toArray() : undefined),
    [mounted]
  );

  // Auto-seed on first run (no onboarding screen)
  const seedingRef = useRef(false);
  useEffect(() => {
    if (!mounted || concepts === undefined || sources === undefined) return;
    if (seedingRef.current) return;
    if (localStorage.getItem('compound_seeded')) return;
    if (concepts.length > 0 || sources.length > 0) return;
    seedingRef.current = true;
    (async () => {
      const db = getDb();
      await db.sources.bulkPut(SEED_SOURCES);
      await db.concepts.bulkPut(SEED_CONCEPTS);
      await db.activity.bulkPut(SEED_ACTIVITY);
      localStorage.setItem('compound_seeded', '1');
    })();
  }, [mounted, concepts, sources]);

  const ready = mounted && concepts !== undefined && sources !== undefined;
  const conceptCount = concepts?.length ?? 0;
  const sourceCount = sources?.length ?? 0;
  const linkCount = concepts?.reduce((s, c) => s + c.related.length, 0) ?? 0;
  const showFab = !detail && (tab === 'wiki' || tab === 'sources');

  return (
    <div className="app-shell">
      <Toast />
      <Header conceptCount={conceptCount} sourceCount={sourceCount} linkCount={linkCount} />

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
          <div key="ask" className="tab-view" style={{ height: '100%' }}><AskView /></div>
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
      <IngestModal />
      <SettingsDrawer />
    </div>
  );
}
