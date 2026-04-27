'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { DESKTOP_LAYOUT_MIN_WIDTH, isDesktopWidth } from '@/lib/responsive';

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { Toast } from '@/components/Toast';
import { SwipeBack } from '@/components/SwipeBack';
import { PullToRefresh } from '@/components/PullToRefresh';
import { Icon } from '@/components/Icons';

const ViewSkeleton = () => (
  <div className="loading-skeleton">
    <div className="skeleton skeleton-header" />
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
  </div>
);

const IngestModal = dynamic(() => import('@/components/IngestModal').then(m => ({ default: m.IngestModal })), { ssr: false });
const SettingsDrawer = dynamic(() => import('@/components/SettingsDrawer').then(m => ({ default: m.SettingsDrawer })), { ssr: false });
const ObsidianImportModal = dynamic(() => import('@/components/ObsidianImportModal').then(m => ({ default: m.ObsidianImportModal })), { ssr: false });
const GithubSyncModal = dynamic(() => import('@/components/GithubSyncModal').then(m => ({ default: m.GithubSyncModal })), { ssr: false });
const WikiView = dynamic(() => import('@/components/views/WikiView').then(m => ({ default: m.WikiView })), { ssr: false, loading: ViewSkeleton });
const LibraryView = dynamic(() => import('@/components/views/LibraryView').then(m => ({ default: m.LibraryView })), { ssr: false, loading: ViewSkeleton });
const SourcesView = dynamic(() => import('@/components/views/SourcesView').then(m => ({ default: m.SourcesView })), { ssr: false, loading: ViewSkeleton });
const AskView = dynamic(() => import('@/components/views/AskView').then(m => ({ default: m.AskView })), { ssr: false, loading: ViewSkeleton });
const ActivityView = dynamic(() => import('@/components/views/ActivityView').then(m => ({ default: m.ActivityView })), { ssr: false, loading: ViewSkeleton });
const ConceptDetail = dynamic(() => import('@/components/views/ConceptDetail').then(m => ({ default: m.ConceptDetail })), { ssr: false, loading: ViewSkeleton });
const SourceDetail = dynamic(() => import('@/components/views/SourceDetail').then(m => ({ default: m.SourceDetail })), { ssr: false, loading: ViewSkeleton });

const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_LAYOUT_MIN_WIDTH}px)`;
const LIBRARY_DETAIL_TRANSITION_MS = 320;

export default function Page() {
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const openModal = useAppStore((s) => s.openModal);
  const openSettings = useAppStore((s) => s.openSettings);
  const back = useAppStore((s) => s.back);
  const homeStyle = useAppStore((s) => s.homeStyle);
  const hydrateHomeStyle = useAppStore((s) => s.hydrateHomeStyle);

  // Only render dexie-driven content after client mount to avoid SSR/CSR mismatch
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [libraryOverlayDetail, setLibraryOverlayDetail] = useState<typeof detail>(null);
  const [libraryOverlayVisible, setLibraryOverlayVisible] = useState(false);
  const libraryOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Browser history support for detail navigation
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      const state = e.state;
      if (state?.detail) {
        useAppStore.setState({ detail: state.detail });
      } else {
        useAppStore.setState({ detail: null });
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const conceptCount = useLiveQuery(
    async () => (mounted ? getDb().concepts.count() : undefined),
    [mounted]
  );
  const sourceCount = useLiveQuery(
    async () => (mounted ? getDb().sources.count() : undefined),
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
      const { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } = await import('@/lib/seed');
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
  const inLibraryMode = tab === 'wiki' && homeStyle === 'library';
  const shouldShowDesktopDetail = isDesktop && !inLibraryMode && (
    tab === 'wiki' ||
    tab === 'sources' ||
    detail !== null
  );
  const desktopSummary = ready
    ? `${conceptCount ?? 0} 个概念 · ${sourceCount ?? 0} 份资料`
    : '正在同步本地知识库';

  useEffect(() => {
    return () => {
      if (libraryOverlayTimerRef.current) {
        clearTimeout(libraryOverlayTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (libraryOverlayTimerRef.current) {
      clearTimeout(libraryOverlayTimerRef.current);
      libraryOverlayTimerRef.current = null;
    }

    if (!isDesktop || !inLibraryMode) {
      setLibraryOverlayVisible(false);
      setLibraryOverlayDetail(null);
      return;
    }

    if (detail) {
      setLibraryOverlayDetail(detail);
      requestAnimationFrame(() => setLibraryOverlayVisible(true));
      return;
    }

    if (libraryOverlayDetail) {
      setLibraryOverlayVisible(false);
      libraryOverlayTimerRef.current = setTimeout(() => {
        setLibraryOverlayDetail(null);
        libraryOverlayTimerRef.current = null;
      }, LIBRARY_DETAIL_TRANSITION_MS);
    }
  }, [detail, inLibraryMode, isDesktop, libraryOverlayDetail]);

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

  function renderDetail(target = detail) {
    if (!target) return null;
    return target.type === 'concept' ? <ConceptDetail id={target.id} /> : <SourceDetail id={target.id} />;
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
          body: '左侧会保留资料列表，右侧以资料正文为主，头部补充来源信息和相关概念。',
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
                className="desktop-sidebar-btn icon-only"
                onClick={openGithubSync}
                aria-label="从 GitHub 同步"
              >
                <Icon.Github />
              </button>
              <Link
                className="desktop-sidebar-btn icon-only"
                href="/sync"
                aria-label="同步控制台"
              >
                <Icon.Activity />
              </Link>
              <button
                className="desktop-sidebar-btn icon-only"
                onClick={openObsidianImport}
                aria-label="从 Obsidian 批量导入"
              >
                <Icon.Ingest />
              </button>
              <button className="desktop-sidebar-btn icon-only" onClick={openSettings} aria-label="打开设置">
                <Icon.Settings />
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

        {/* Library mode: detail as modal overlay */}
        {homeStyle === 'library' && libraryOverlayDetail && (
          <div
            className={`library-detail-overlay${libraryOverlayVisible ? ' is-open' : ''}`}
            aria-hidden={!libraryOverlayVisible}
            onClick={back}
          >
            <div
              className="library-detail-modal"
              role="dialog"
              aria-modal="true"
              aria-label="概念详情"
              onClick={(e) => e.stopPropagation()}
            >
              <button className="library-detail-modal-close" onClick={back} aria-label="关闭">✕</button>
              <div className="library-detail-modal-scroll">
                {renderDetail(libraryOverlayDetail)}
              </div>
            </div>
          </div>
        )}

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
      <PullToRefresh onRefresh={async () => {
        const { pullSnapshotFromCloud } = await import('@/lib/cloud-sync');
        await pullSnapshotFromCloud();
        useAppStore.getState().showToast('数据已刷新');
      }} />
      <Header conceptCount={conceptCount ?? 0} sourceCount={sourceCount ?? 0} />

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
