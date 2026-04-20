'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } from '@/lib/seed';
import { DESKTOP_LAYOUT_MIN_WIDTH, isDesktopWidth } from '@/lib/responsive';

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { SwipeBack } from '@/components/SwipeBack';
import { Icon } from '@/components/Icons';

const IngestModal = dynamic(() => import('@/components/IngestModal').then(m => ({ default: m.IngestModal })), { ssr: false });
const SettingsDrawer = dynamic(() => import('@/components/SettingsDrawer').then(m => ({ default: m.SettingsDrawer })), { ssr: false });
const ObsidianImportModal = dynamic(() => import('@/components/ObsidianImportModal').then(m => ({ default: m.ObsidianImportModal })), { ssr: false });
const GithubSyncModal = dynamic(() => import('@/components/GithubSyncModal').then(m => ({ default: m.GithubSyncModal })), { ssr: false });
const WikiView = dynamic(() => import('@/components/views/WikiView').then(m => ({ default: m.WikiView })), { ssr: false });
const LibraryView = dynamic(() => import('@/components/views/LibraryView').then(m => ({ default: m.LibraryView })), { ssr: false });
const SourcesView = dynamic(() => import('@/components/views/SourcesView').then(m => ({ default: m.SourcesView })), { ssr: false });
const AskView = dynamic(() => import('@/components/views/AskView').then(m => ({ default: m.AskView })), { ssr: false });
const ActivityView = dynamic(() => import('@/components/views/ActivityView').then(m => ({ default: m.ActivityView })), { ssr: false });
const ConceptDetail = dynamic(() => import('@/components/views/ConceptDetail').then(m => ({ default: m.ConceptDetail })), { ssr: false });
const SourceDetail = dynamic(() => import('@/components/views/SourceDetail').then(m => ({ default: m.SourceDetail })), { ssr: false });

const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_LAYOUT_MIN_WIDTH}px)`;

export default function Page() {
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const openModal = useAppStore((s) => s.openModal);
  const openSettings = useAppStore((s) => s.openSettings);
  const homeStyle = useAppStore((s) => s.homeStyle);
  const hydrateHomeStyle = useAppStore((s) => s.hydrateHomeStyle);

  // Only render dexie-driven content after client mount to avoid SSR/CSR mismatch
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    setMounted(true);
    hydrateHomeStyle();
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncLayout = () => setIsDesktop(isDesktopWidth(window.innerWidth) && media.matches);

    syncLayout();
    media.addEventListener('change', syncLayout);
    window.addEventListener('resize', syncLayout);

    return () => {
      media.removeEventListener('change', syncLayout);
      window.removeEventListener('resize', syncLayout);
    };
  }, [hydrateHomeStyle]);

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

  // Pull cloud snapshot once on mount so all browsers share the same view.
  const pulledRef = useRef(false);
  useEffect(() => {
    if (!mounted || pulledRef.current) return;
    pulledRef.current = true;
    (async () => {
      try {
        const { pullSnapshotFromCloud } = await import('@/lib/cloud-sync');
        await pullSnapshotFromCloud();
      } catch (e) {
        // Non-fatal: local-only mode still works.
        console.warn('[cloud-sync] snapshot pull failed:', e);
      }
    })();
  }, [mounted]);

  const ready = mounted && conceptCount !== undefined && sourceCount !== undefined;
  const modalOpen = useAppStore((s) => s.modalOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const obsidianImportOpen = useAppStore((s) => s.obsidianImportOpen);
  const githubSyncOpen = useAppStore((s) => s.githubSyncOpen);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);
  const showFab = !detail && (tab === 'wiki' || tab === 'sources');
  const shouldShowDesktopDetail = isDesktop && (tab === 'wiki' || tab === 'sources' || detail !== null);
  const desktopSummary = ready
    ? `${conceptCount ?? 0} 个概念 · ${sourceCount ?? 0} 份资料 · ${linkCount ?? 0} 条引用`
    : '正在同步本地知识库';

  const bootShell = (
    <div className="app-shell">
      <main className="app-main">
        <div className="loading-skeleton" aria-label="正在加载..." aria-busy="true">
          <div className="skeleton skeleton-header" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
          <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
        </div>
      </main>
    </div>
  );

  function renderDetail() {
    if (!detail) return null;
    return detail.type === 'concept' ? <ConceptDetail id={detail.id} /> : <SourceDetail id={detail.id} />;
  }

  function renderPrimaryView(scrollRootSelector?: string) {
    if (!ready) {
      return (
        <div className="loading-skeleton" aria-label="正在加载..." aria-busy="true">
          <div className="skeleton skeleton-header" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
          <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
        </div>
      );
    }

    if (tab === 'wiki') {
      return homeStyle === 'library'
        ? <LibraryView scrollRootSelector={scrollRootSelector} />
        : <WikiView scrollRootSelector={scrollRootSelector} />;
    }
    if (tab === 'sources') {
      return <SourcesView />;
    }
    if (tab === 'ask') {
      return <AskView />;
    }
    return <ActivityView />;
  }

  function renderDesktopDetailEmpty() {
    const copy = tab === 'sources'
      ? {
          title: '选择一份资料',
          body: '左侧会保留资料列表，右侧展示原文摘要、来源信息和生成的概念。',
        }
      : {
          title: '选择一个概念',
          body: '左侧继续浏览概念列表，右侧会展示正文、引用资料和相关概念。',
        };

    return (
      <div className="desktop-detail-empty">
        <div className="desktop-detail-empty-inner">
          <div className="desktop-detail-kicker">桌面阅读模式</div>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
      </div>
    );
  }

  if (!mounted) {
    return bootShell;
  }

  if (isDesktop) {
    return (
      <div className="app-shell desktop-shell">
        <Toast />

        <div className="desktop-frame">
          <aside className="desktop-sidebar">
            <div className="desktop-brand">
              <div className="desktop-brand-kicker">Compound</div>
              <div className="desktop-brand-title">Karpathy 知识库</div>
              <div className="desktop-brand-meta">{desktopSummary}</div>
            </div>

            <TabBar variant="sidebar" />

            <div className="desktop-sidebar-footer">
              <button
                className="desktop-sidebar-btn"
                onClick={openGithubSync}
                aria-label="从 GitHub 同步"
              >
                <Icon.Github />
                <span>从 GitHub 同步</span>
              </button>
              <button
                className="desktop-sidebar-btn"
                onClick={openObsidianImport}
                aria-label="从 Obsidian 批量导入"
              >
                <Icon.Ingest />
                <span>导入本地 Obsidian</span>
              </button>
              <button className="desktop-sidebar-btn" onClick={openSettings} aria-label="打开设置">
                <Icon.Settings />
                <span>设置与工具</span>
              </button>
            </div>
          </aside>

          <main className={`desktop-content${shouldShowDesktopDetail ? '' : ' single-pane'}`}>
            <section className="desktop-primary-panel">
              <div className="desktop-primary-scroll">
                {renderPrimaryView('.desktop-primary-scroll')}
              </div>

              {showFab && ready && (
                <button className="fab desktop-fab" onClick={openModal} aria-label="添加资料">
                  <Icon.Plus />
                </button>
              )}
            </section>

            {shouldShowDesktopDetail && (
              <aside className="desktop-detail-panel">
                <div className="desktop-detail-scroll">
                  {detail ? renderDetail() : renderDesktopDetailEmpty()}
                </div>
              </aside>
            )}
          </main>
        </div>

        {modalOpen && <IngestModal />}
        {settingsOpen && <SettingsDrawer />}
        {obsidianImportOpen && <ObsidianImportModal />}
        {githubSyncOpen && <GithubSyncModal />}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toast />
      <SwipeBack />
      <Header conceptCount={conceptCount ?? 0} sourceCount={sourceCount ?? 0} linkCount={linkCount ?? 0} />

      <main className="app-main">
        {!ready ? renderPrimaryView('.app-main') : detail ? (
          <div key={detail.id} className="detail-view">
            {renderDetail()}
          </div>
        ) : (
          <div key={tab} className={`tab-view${tab === 'ask' ? ' ask-tab' : ''}`}>
            {renderPrimaryView('.app-main')}
          </div>
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
      {obsidianImportOpen && <ObsidianImportModal />}
      {githubSyncOpen && <GithubSyncModal />}
    </div>
  );
}
