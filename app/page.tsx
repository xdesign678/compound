'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';
import { canReadPrivateCache } from '@/lib/admin-auth-client';
import { useAppStore, type TabId } from '@/lib/store';
import { DESKTOP_LAYOUT_MIN_WIDTH, isDesktopWidth } from '@/lib/responsive';

import { Header } from '@/components/Header';
import { TabBar } from '@/components/TabBar';
import { ListTree } from 'lucide-react';
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { useResizable } from '@/lib/hooks/useResizable';
import { PullToRefresh } from '@/components/PullToRefresh';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { t, useLocale } from '@/lib/i18n';

const CommandPalette = dynamic(
  () => import('@/components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
);
const OfflineBanner = dynamic(
  () => import('@/components/OfflineBanner').then((m) => ({ default: m.OfflineBanner })),
  { ssr: false },
);
const TaskCenter = dynamic(
  () => import('@/components/TaskCenter').then((m) => ({ default: m.TaskCenter })),
  { ssr: false },
);
const SelectionWikiProgress = dynamic(
  () =>
    import('@/components/SelectionWikiProgress').then((m) => ({
      default: m.SelectionWikiProgress,
    })),
  { ssr: false },
);
const SwipeBack = dynamic(
  () => import('@/components/SwipeBack').then((m) => ({ default: m.SwipeBack })),
  { ssr: false },
);
import { Icon } from '@/components/Icons';

const ViewSkeleton = () => (
  <div
    className="loading-skeleton"
    role="status"
    aria-live="polite"
    aria-label="正在加载内容"
    aria-busy="true"
  >
    <div className="loading-copy">
      <span>正在同步本地知识库</span>
      <strong>稍等一下，内容马上出来。</strong>
    </div>
    <div className="skeleton skeleton-header" />
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
  </div>
);

const IngestModal = dynamic(
  () => import('@/components/IngestModal').then((m) => ({ default: m.IngestModal })),
  { ssr: false },
);
const SettingsDrawer = dynamic(
  () => import('@/components/SettingsDrawer').then((m) => ({ default: m.SettingsDrawer })),
  { ssr: false },
);
const ObsidianImportModal = dynamic(
  () =>
    import('@/components/ObsidianImportModal').then((m) => ({ default: m.ObsidianImportModal })),
  { ssr: false },
);
const GithubSyncModal = dynamic(
  () => import('@/components/GithubSyncModal').then((m) => ({ default: m.GithubSyncModal })),
  { ssr: false },
);
const WikiView = dynamic(
  () => import('@/components/views/WikiView').then((m) => ({ default: m.WikiView })),
  { ssr: false, loading: ViewSkeleton },
);
const LibraryView = dynamic(
  () => import('@/components/views/LibraryView').then((m) => ({ default: m.LibraryView })),
  { ssr: false, loading: ViewSkeleton },
);
const SourcesView = dynamic(
  () => import('@/components/views/SourcesView').then((m) => ({ default: m.SourcesView })),
  { ssr: false, loading: ViewSkeleton },
);
const AskView = dynamic(
  () => import('@/components/views/AskView').then((m) => ({ default: m.AskView })),
  { ssr: false, loading: ViewSkeleton },
);
const ActivityView = dynamic(
  () => import('@/components/views/ActivityView').then((m) => ({ default: m.ActivityView })),
  { ssr: false, loading: ViewSkeleton },
);
const ConceptDetail = dynamic(
  () => import('@/components/views/ConceptDetail').then((m) => ({ default: m.ConceptDetail })),
  { ssr: false, loading: ViewSkeleton },
);
const SourceDetail = dynamic(
  () => import('@/components/views/SourceDetail').then((m) => ({ default: m.SourceDetail })),
  { ssr: false, loading: ViewSkeleton },
);
const CategoryWikiDetail = dynamic(
  () =>
    import('@/components/views/CategoryWikiDetail').then((m) => ({
      default: m.CategoryWikiDetail,
    })),
  { ssr: false, loading: ViewSkeleton },
);

const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_LAYOUT_MIN_WIDTH}px)`;
const LIBRARY_DETAIL_TRANSITION_MS = 320;
const MODAL_EXIT_DURATION_MS = 320;
const SCROLL_RESTORE_INTERVAL_MS = 50;
const SCROLL_RESTORE_MAX_ATTEMPTS = 30;
const SCROLL_RESTORE_CONFIRM_WINDOW_MS = 600;

// page 本身会被 SSR，layout effect 需要在服务端降级为 useEffect
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function useDelayedUnmount(isOpen: boolean, delayMs = MODAL_EXIT_DURATION_MS): boolean {
  const [shouldRender, setShouldRender] = useState(isOpen);
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    } else {
      const timer = setTimeout(() => setShouldRender(false), delayMs);
      return () => clearTimeout(timer);
    }
  }, [isOpen, delayMs]);
  return shouldRender;
}

export default function Page() {
  useLocale();
  useKeyboardShortcuts();
  useOnlineStatus();
  const tab = useAppStore((s) => s.tab);
  const detail = useAppStore((s) => s.detail);
  const openModal = useAppStore((s) => s.openModal);
  const openSettings = useAppStore((s) => s.openSettings);
  const back = useAppStore((s) => s.back);
  const homeStyle = useAppStore((s) => s.homeStyle);
  const hydrateHomeStyle = useAppStore((s) => s.hydrateHomeStyle);
  const hydrateFontSize = useAppStore((s) => s.hydrateFontSize);
  const hydrateLineHeight = useAppStore((s) => s.hydrateLineHeight);
  const [cacheAccessGranted, setCacheAccessGranted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void canReadPrivateCache().then((granted) => {
      if (cancelled) return;
      if (granted) {
        setCacheAccessGranted(true);
      } else {
        window.location.replace('/offline');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Only render dexie-driven content after client mount to avoid SSR/CSR mismatch
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [libraryOverlayDetail, setLibraryOverlayDetail] = useState<typeof detail>(null);
  const [libraryOverlayVisible, setLibraryOverlayVisible] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const libraryOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const desktopContentRef = useRef<HTMLElement>(null);
  const libraryDetailDialogRef = useRef<HTMLDivElement>(null);
  const mobileDetailDialogRef = useRef<HTMLDivElement>(null);
  const mobileAskDialogRef = useRef<HTMLDivElement>(null);
  const appMainRef = useRef<HTMLElement>(null);
  const tabScrollPositionsRef = useRef<Partial<Record<TabId, number>>>({});
  const currentTabRef = useRef(tab);
  const restoreTargetRef = useRef(0);
  useEffect(() => {
    if (!cacheAccessGranted) return;
    setMounted(true);
    hydrateHomeStyle();
    hydrateFontSize();
    hydrateLineHeight();
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const syncLayout = () => setIsDesktop(isDesktopWidth(window.innerWidth) && media.matches);

    syncLayout();
    media.addEventListener('change', syncLayout);
    window.addEventListener('resize', syncLayout);

    return () => {
      media.removeEventListener('change', syncLayout);
      window.removeEventListener('resize', syncLayout);
    };
  }, [cacheAccessGranted, hydrateHomeStyle, hydrateFontSize, hydrateLineHeight]);

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
    [mounted],
  );
  const sourceCount = useLiveQuery(
    async () => (mounted ? getDb().sources.count() : undefined),
    [mounted],
  );

  // Cloud reconciliation must finish before first-run sample seeding, otherwise
  // a populated server can be mixed with local demo records.
  const bootstrapRef = useRef(false);
  useEffect(() => {
    if (!mounted || bootstrapRef.current) return;
    bootstrapRef.current = true;
    let cancelled = false;
    (async () => {
      let cloudAuthorityEmpty = false;
      try {
        const { pullSnapshotFromCloud } = await import('@/lib/cloud-sync');
        const pullResult = await pullSnapshotFromCloud();
        cloudAuthorityEmpty = pullResult.authoritativeEmpty;
      } catch (e) {
        // Non-fatal: local-only mode still works.
        console.warn('[cloud-sync] snapshot pull failed:', e);
      }

      const db = getDb();
      const [currentConceptCount, currentSourceCount] = await Promise.all([
        db.concepts.count(),
        db.sources.count(),
      ]);
      if (
        cloudAuthorityEmpty &&
        currentConceptCount === 0 &&
        currentSourceCount === 0 &&
        !localStorage.getItem('compound_seeded')
      ) {
        const { SEED_SOURCES, SEED_CONCEPTS, SEED_ACTIVITY } = await import('@/lib/seed');
        await db.transaction('rw', [db.sources, db.concepts, db.activity], async () => {
          await db.sources.bulkPut(SEED_SOURCES);
          await db.concepts.bulkPut(SEED_CONCEPTS);
          await db.activity.bulkPut(SEED_ACTIVITY);
        });
        localStorage.setItem('compound_seeded', '1');
        localStorage.setItem('compound_is_sample', '1');
      }
      if (!cancelled) setBootstrapReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const hasLocalRows = (conceptCount ?? 0) > 0 || (sourceCount ?? 0) > 0;
  const ready =
    mounted &&
    (bootstrapReady || hasLocalRows) &&
    conceptCount !== undefined &&
    sourceCount !== undefined;
  const modalOpen = useAppStore((s) => s.modalOpen);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const obsidianImportOpen = useAppStore((s) => s.obsidianImportOpen);
  const githubSyncOpen = useAppStore((s) => s.githubSyncOpen);
  const renderModal = useDelayedUnmount(modalOpen);
  const renderSettings = useDelayedUnmount(settingsOpen);
  const renderObsidianImport = useDelayedUnmount(obsidianImportOpen);
  const renderGithubSync = useDelayedUnmount(githubSyncOpen);
  const openObsidianImport = useAppStore((s) => s.openObsidianImport);
  const openGithubSync = useAppStore((s) => s.openGithubSync);
  const inLibraryMode = tab === 'wiki' && homeStyle === 'library';
  const usesDetailOverlay = inLibraryMode || tab === 'ask';
  const shouldShowDesktopDetail =
    isDesktop && !usesDetailOverlay && (tab === 'wiki' || tab === 'sources' || detail !== null);
  const { dividerProps } = useResizable(desktopContentRef, shouldShowDesktopDetail);
  const desktopSummary = ready
    ? `${conceptCount ?? 0} 个概念 · ${sourceCount ?? 0} 份资料`
    : '正在同步本地知识库';

  useFocusTrap(
    libraryDetailDialogRef,
    isDesktop && usesDetailOverlay && libraryOverlayVisible && libraryOverlayDetail !== null,
  );
  useFocusTrap(mobileDetailDialogRef, !isDesktop && detail !== null && tab !== 'ask');
  useFocusTrap(
    mobileAskDialogRef,
    !isDesktop && tab === 'ask' && libraryOverlayVisible && libraryOverlayDetail !== null,
  );

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

    if (!usesDetailOverlay) {
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
  }, [detail, usesDetailOverlay, libraryOverlayDetail]);

  // 移动端按 tab 记住 .app-main 滚动位置：视图靠 key={tab} 重挂载，新视图先以
  // 矮内容挂载会把 scrollTop 钳到中间位置。切走时持续记录，切回后等内容撑高再恢复。
  //
  // 时序上有个坑：DOM 替换后浏览器钳制 scrollTop 触发的 scroll 事件是异步派发的，
  // 会晚于 passive effect 的清理/安装，把钳制值错记到旧 tab 名下、或盖掉新 tab 的
  // 恢复目标。因此在布局阶段（提交后、scroll 事件派发前）同步快照当前 tab 与恢复
  // 目标，滚动监听用常驻 + ref 读当前 tab 的方式规避这两个竞态。
  useIsomorphicLayoutEffect(() => {
    currentTabRef.current = tab;
    restoreTargetRef.current = tabScrollPositionsRef.current[tab] ?? 0;
  }, [tab]);

  // mounted 前渲染的是骨架分支（main 无 ref），依赖里带上 mounted 才能在真实
  // 滚动容器挂载后补上监听。
  useEffect(() => {
    const mainEl = appMainRef.current;
    if (!mainEl) return;
    const saveScroll = () => {
      tabScrollPositionsRef.current[currentTabRef.current] = mainEl.scrollTop;
    };
    mainEl.addEventListener('scroll', saveScroll, { passive: true });
    return () => mainEl.removeEventListener('scroll', saveScroll);
  }, [isDesktop, mounted]);

  useEffect(() => {
    const mainEl = appMainRef.current;
    if (!mainEl) return;
    const target = restoreTargetRef.current;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let confirmTimer: ReturnType<typeof setTimeout> | null = null;

    const restoreScroll = () => {
      if (cancelled) return;
      // 视图内容（动态 chunk + live query）可能尚未撑高容器，等它足够高再写
      // scrollTop，否则会被再次钳制；用户一旦主动滚动就放弃恢复。
      if (
        mainEl.scrollHeight - mainEl.clientHeight < target &&
        attempts < SCROLL_RESTORE_MAX_ATTEMPTS
      ) {
        attempts += 1;
        timer = setTimeout(restoreScroll, SCROLL_RESTORE_INTERVAL_MS);
        return;
      }
      mainEl.scrollTop = target;
      // 个别视图挂载后还会做一次自己的滚动恢复（如 WikiView 的锚点定位），时机不定；
      // 在短窗口内反复校正漂移，确保最终停在切走时的位置。用户滚动会立即取消整个恢复。
      const deadline = Date.now() + SCROLL_RESTORE_CONFIRM_WINDOW_MS;
      const confirmScroll = () => {
        if (cancelled || Date.now() > deadline) return;
        if (mainEl.scrollTop !== target) {
          mainEl.scrollTop = target;
        }
        confirmTimer = setTimeout(confirmScroll, SCROLL_RESTORE_INTERVAL_MS);
      };
      confirmTimer = setTimeout(confirmScroll, SCROLL_RESTORE_INTERVAL_MS);
    };

    const cancelOnUserScroll = () => {
      cancelled = true;
    };

    const frame = requestAnimationFrame(() => requestAnimationFrame(restoreScroll));
    mainEl.addEventListener('wheel', cancelOnUserScroll, { passive: true });
    mainEl.addEventListener('touchstart', cancelOnUserScroll, { passive: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
      if (confirmTimer) clearTimeout(confirmTimer);
      mainEl.removeEventListener('wheel', cancelOnUserScroll);
      mainEl.removeEventListener('touchstart', cancelOnUserScroll);
    };
  }, [tab]);

  const skeletonContent = (
    <div className="loading-skeleton" aria-label="正在加载..." aria-busy="true">
      <div className="loading-copy">
        <span>正在同步本地知识库</span>
        <strong>稍等一下，内容马上出来。</strong>
      </div>
      <div className="skeleton skeleton-header" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" style={{ opacity: 0.7 }} />
      <div className="skeleton skeleton-card" style={{ opacity: 0.4 }} />
    </div>
  );

  function detailAriaLabel(target: NonNullable<typeof detail>) {
    if (target.type === 'concept') return '概念详情';
    if (target.type === 'category-wiki') return '分类 Wiki 详情';
    return '资料详情';
  }

  function renderDetail(target = detail) {
    if (!target) return null;
    if (target.type === 'concept') {
      return <ConceptDetail id={target.id} />;
    }
    if (target.type === 'category-wiki' && target.primary && target.secondary) {
      return <CategoryWikiDetail primary={target.primary} secondary={target.secondary} />;
    }
    return <SourceDetail id={target.id} />;
  }

  function renderPrimaryView(scrollRootSelector?: string) {
    if (!ready) {
      return skeletonContent;
    }

    if (tab === 'wiki') {
      return homeStyle === 'library' ? (
        <LibraryView scrollRootSelector={scrollRootSelector} />
      ) : (
        <WikiView scrollRootSelector={scrollRootSelector} />
      );
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
    const copy =
      tab === 'sources'
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
    return (
      <div className="app-shell">
        {/* 与真实 Header/TabBar 同尺寸的占位轮廓，消除首屏底部栏 pop-in */}
        <header className="header" aria-hidden="true">
          <div className="header-copy">
            <div className="skeleton" style={{ width: 56, height: 10, marginBottom: 4 }} />
            <div className="skeleton" style={{ width: 96, height: 20, marginBottom: 4 }} />
            <div className="skeleton" style={{ width: 150, height: 11 }} />
          </div>
          <div className="header-actions">
            <div
              className="skeleton"
              style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)' }}
            />
            <div
              className="skeleton"
              style={{ width: 44, height: 44, borderRadius: 'var(--radius-control)' }}
            />
          </div>
        </header>
        <main className="app-main">{skeletonContent}</main>
        <nav className="tabbar" aria-hidden="true">
          <div className="tab-item">
            <span
              className="skeleton"
              style={{ width: 22, height: 22, borderRadius: 'var(--radius-full)' }}
            />
            <span className="skeleton" style={{ width: 30, height: 10 }} />
          </div>
          <div className="tab-item">
            <span
              className="skeleton"
              style={{ width: 22, height: 22, borderRadius: 'var(--radius-full)' }}
            />
            <span className="skeleton" style={{ width: 30, height: 10 }} />
          </div>
          <div className="tab-add">
            <span
              className="skeleton"
              style={{ width: 40, height: 40, borderRadius: 'var(--radius-full)' }}
            />
          </div>
          <div className="tab-item">
            <span
              className="skeleton"
              style={{ width: 22, height: 22, borderRadius: 'var(--radius-full)' }}
            />
            <span className="skeleton" style={{ width: 30, height: 10 }} />
          </div>
          <div className="tab-item">
            <span
              className="skeleton"
              style={{ width: 22, height: 22, borderRadius: 'var(--radius-full)' }}
            />
            <span className="skeleton" style={{ width: 30, height: 10 }} />
          </div>
        </nav>
      </div>
    );
  }

  if (isDesktop) {
    return (
      <div className="app-shell desktop-shell">
        <OfflineBanner />
        <CommandPalette />

        <div className="desktop-frame">
          <aside className="desktop-sidebar">
            <div className="desktop-brand">
              <div className="desktop-brand-kicker">Compound</div>
              <div className="desktop-brand-title">{t('header.wiki.title')}</div>
              <div className="desktop-brand-meta">{desktopSummary}</div>
            </div>

            <TabBar variant="sidebar" />

            <button type="button" className="desktop-sidebar-add" onClick={openModal}>
              <span aria-hidden="true">
                <Icon.Plus />
              </span>
              <span>{t('tab.addSource')}</span>
            </button>

            <div className="desktop-sidebar-footer">
              <button
                type="button"
                className="desktop-sidebar-btn icon-only"
                onClick={openGithubSync}
                aria-label={t('header.githubSync')}
                title={t('header.githubSync')}
              >
                <span aria-hidden="true">
                  <Icon.Github />
                </span>
              </button>
              <Link
                className="desktop-sidebar-btn icon-only"
                href="/sync"
                aria-label={t('header.syncConsole')}
                title={t('header.syncConsole')}
              >
                <span aria-hidden="true">
                  <Icon.Activity />
                </span>
              </Link>
              <button
                type="button"
                className="desktop-sidebar-btn icon-only"
                onClick={openObsidianImport}
                aria-label={t('header.obsidianImport')}
                title={t('header.obsidianImport')}
              >
                <span aria-hidden="true">
                  <Icon.Ingest />
                </span>
              </button>
              <button
                type="button"
                className="desktop-sidebar-btn icon-only"
                onClick={openSettings}
                aria-label={t('header.settings')}
                title={t('header.settings')}
              >
                <span aria-hidden="true">
                  <Icon.Settings />
                </span>
              </button>
            </div>
          </aside>

          <main
            ref={desktopContentRef}
            className={`desktop-content${shouldShowDesktopDetail ? ' resizable' : ' single-pane'}`}
          >
            <section
              className="desktop-primary-panel"
              id={`tabpanel-${tab}`}
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
            >
              <div className="desktop-primary-scroll">
                {renderPrimaryView('.desktop-primary-scroll')}
              </div>
            </section>

            {shouldShowDesktopDetail && <div className="desktop-divider" {...dividerProps} />}

            {shouldShowDesktopDetail && (
              <aside className="desktop-detail-panel">
                {/* 目录入口：与移动端 overlay 同一个事件，分类 Wiki 详情没有目录抽屉，不显示 */}
                {detail && detail.type !== 'category-wiki' && (
                  <button
                    type="button"
                    className="icon-btn desktop-detail-toc-btn"
                    aria-label="打开目录"
                    title="打开目录"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent(
                          detail.type === 'concept'
                            ? 'compound:open-concept-toc'
                            : 'compound:open-source-toc',
                        ),
                      )
                    }
                  >
                    <span aria-hidden="true">
                      <ListTree />
                    </span>
                  </button>
                )}
                <div className="desktop-detail-scroll">
                  {detail ? renderDetail() : renderDesktopDetailEmpty()}
                </div>
              </aside>
            )}
          </main>
        </div>

        {/* Library and ask mode: detail as side overlay */}
        {usesDetailOverlay && libraryOverlayDetail && (
          <div
            className={`library-detail-overlay${tab === 'ask' ? ' ask-detail-overlay' : ''}${libraryOverlayVisible ? ' is-open' : ''}`}
            aria-hidden={!libraryOverlayVisible}
            onClick={back}
          >
            <div
              className={`library-detail-modal${tab === 'ask' ? ' ask-detail-modal' : ''}`}
              ref={libraryDetailDialogRef}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              aria-label={detailAriaLabel(libraryOverlayDetail)}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="library-detail-modal-close" onClick={back} aria-label="关闭">
                ✕
              </button>
              {/* 目录入口：概念/资料详情组件监听事件并自渲染抽屉；分类 Wiki 无目录抽屉 */}
              {libraryOverlayDetail.type !== 'category-wiki' && (
                <button
                  type="button"
                  className="icon-btn library-detail-modal-toc"
                  aria-label="打开目录"
                  title="打开目录"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent(
                        libraryOverlayDetail.type === 'concept'
                          ? 'compound:open-concept-toc'
                          : 'compound:open-source-toc',
                      ),
                    )
                  }
                >
                  <span aria-hidden="true">
                    <ListTree />
                  </span>
                </button>
              )}
              <div className="library-detail-modal-scroll">
                {renderDetail(libraryOverlayDetail)}
              </div>
            </div>
          </div>
        )}

        {renderModal && <IngestModal />}
        {renderSettings && <SettingsDrawer />}
        {renderObsidianImport && <ObsidianImportModal />}
        {renderGithubSync && <GithubSyncModal />}
        <SelectionWikiProgress />
        <TaskCenter />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <OfflineBanner />
      <CommandPalette />
      <SwipeBack />
      <PullToRefresh
        onRefresh={async () => {
          const { pullSnapshotFromCloud } = await import('@/lib/cloud-sync');
          await pullSnapshotFromCloud();
          useAppStore.getState().showToast('数据已刷新');
        }}
      />
      {!(detail && tab !== 'ask') && (
        <Header conceptCount={conceptCount ?? 0} sourceCount={sourceCount ?? 0} loading={!ready} />
      )}

      <main className="app-main" ref={appMainRef}>
        <div
          key={tab}
          id={`tabpanel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className={`tab-view${tab === 'ask' ? ' ask-tab' : ''}`}
        >
          {renderPrimaryView('.app-main')}
        </div>
      </main>

      {/* Mobile detail overlay — replaces the old in-flow .detail-view */}
      {detail && tab !== 'ask' && !isDesktop && (
        <div
          className="mobile-detail-overlay"
          ref={mobileDetailDialogRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          aria-label={detailAriaLabel(detail)}
        >
          <header className="mobile-detail-header">
            <button type="button" className="back-btn" onClick={back}>
              <span aria-hidden="true">
                <Icon.Back />
              </span>
              <span>返回</span>
            </button>
            {/* 目录入口：概念/资料详情组件监听这个事件；分类 Wiki 详情没有目录抽屉，不显示入口 */}
            {detail.type !== 'category-wiki' && (
              <button
                type="button"
                className="icon-btn mobile-detail-toc-btn"
                aria-label="打开目录"
                title="打开目录"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent(
                      detail.type === 'concept'
                        ? 'compound:open-concept-toc'
                        : 'compound:open-source-toc',
                    ),
                  )
                }
              >
                <span aria-hidden="true">
                  <ListTree />
                </span>
              </button>
            )}
          </header>
          <div className="mobile-detail-scroll">{renderDetail()}</div>
        </div>
      )}

      {tab === 'ask' && libraryOverlayDetail && (
        <div
          className={`library-detail-overlay ask-detail-overlay${libraryOverlayVisible ? ' is-open' : ''}`}
          aria-hidden={!libraryOverlayVisible}
          onClick={back}
        >
          <div
            className="library-detail-modal ask-detail-modal"
            ref={mobileAskDialogRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={detailAriaLabel(libraryOverlayDetail)}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="library-detail-modal-close" onClick={back} aria-label="关闭">
              ✕
            </button>
            <div className="library-detail-modal-scroll">{renderDetail(libraryOverlayDetail)}</div>
          </div>
        </div>
      )}

      {!(detail && tab !== 'ask') && <TabBar />}
      <SelectionWikiProgress />
      <TaskCenter />
      {renderModal && <IngestModal />}
      {renderSettings && <SettingsDrawer />}
      {renderObsidianImport && <ObsidianImportModal />}
      {renderGithubSync && <GithubSyncModal />}
    </div>
  );
}
