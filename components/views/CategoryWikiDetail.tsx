'use client';

import './category-wiki-detail.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadMarked, loadDOMPurify, escapeHTML } from '@/lib/format';
import { useAppStore } from '@/lib/store';
import {
  getCategoryWiki,
  createCategoryWikiRun,
  getCategoryWikiRunStatus,
  listCategoryWikiRuns,
} from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';
import type {
  CategoryWiki,
  CategoryWikiRunPhase,
  CategoryWikiRunStatus,
  CategoryWikiRunStatusResponse,
  CategoryWikiRunSummary,
  Concept,
} from '@/lib/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/db';

const POLL_INTERVAL_MS = 1_500;

const PHASE_LABEL: Record<CategoryWikiRunPhase, string> = {
  queued: '排队中',
  loading_context: '整理上下文',
  generating: 'AI 正在生成',
  persisting: '写入 Wiki',
  done: '已完成',
};

const PROGRESS_PHASES: CategoryWikiRunPhase[] = [
  'queued',
  'loading_context',
  'generating',
  'persisting',
];

const PHASE_DESCRIPTION: Record<CategoryWikiRunPhase, string> = {
  queued: '正在排队等待 AI...',
  loading_context: '正在汇总该主题下的所有概念...',
  generating: 'AI 正在综合写作中，请稍候...',
  persisting: '即将完成，正在保存...',
  done: '已完成',
};

const RUN_STATUS_LABEL: Record<CategoryWikiRunStatus, string> = {
  running: '进行中',
  done: '已完成',
  failed: '失败',
};

const HISTORY_LIMIT = 10;

interface TocItem {
  level: number;
  title: string;
  id: string;
}

interface CategoryWikiDetailProps {
  primary: string;
  secondary: string;
}

function slugify(text: string): string {
  return text
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .slice(0, 40)
    .toLowerCase();
}

function extractTocFromMd(md: string): TocItem[] {
  const items: TocItem[] = [];
  const seen = new Map<string, number>();
  for (const line of md.split('\n')) {
    const match = line.match(/^(#{1,4})\s+(.+)/);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim();
    let base = slugify(title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count > 0 ? `${base}-${count}` : base;
    items.push({ level, title, id });
  }
  return items;
}

function renderMarkdownWithWikilinks(md: string, conceptTitleMap: Map<string, string>): string {
  const toc = extractTocFromMd(md);
  let result = md;

  for (const item of toc) {
    const headingRe = new RegExp(`^(#{${item.level}})\\s+${escapeRegExp(item.title)}`, 'm');
    result = result.replace(headingRe, `$1 <span id="${item.id}">${item.title}</span>`);
  }

  result = result.replace(/\[\[([^\]]+)\]\]/g, (_match, title: string) => {
    const conceptId = conceptTitleMap.get(title.trim());
    if (conceptId) {
      return `<a data-wikilink="${conceptId}" class="wikilink">${title}</a>`;
    }
    return `<span class="wikilink wikilink--broken">${title}</span>`;
  });

  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let mermaidModule: typeof import('mermaid') | null = null;
let mermaidLoadPromise: Promise<typeof import('mermaid') | null> | null = null;

async function loadMermaid() {
  if (mermaidModule) return mermaidModule;
  if (mermaidLoadPromise) return mermaidLoadPromise;
  mermaidLoadPromise = import('mermaid')
    .then((mod) => {
      mermaidModule = mod;
      mod.default.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'strict',
        flowchart: { htmlLabels: false },
      });
      return mod;
    })
    .catch(() => null);
  return mermaidLoadPromise;
}

async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const [mermaid, domPurify] = await Promise.all([loadMermaid(), loadDOMPurify()]);
  if (!mermaid || !domPurify) return;

  const codeBlocks = container.querySelectorAll('code.language-mermaid');
  for (let i = 0; i < codeBlocks.length; i++) {
    const code = codeBlocks[i];
    const pre = code.closest('pre');
    if (!pre) continue;

    const rawCode = code.textContent ?? '';
    const chartId = `mermaid-category-wiki-${i}`;

    try {
      const { svg } = await mermaid.default.render(chartId, rawCode);
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-chart';
      wrapper.innerHTML = domPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['href', 'xlink:href', 'style'],
      });
      pre.replaceWith(wrapper);
    } catch {
      const fallback = document.createElement('div');
      fallback.className = 'mermaid-chart mermaid-chart--error';
      fallback.textContent = rawCode;
      pre.replaceWith(fallback);
    }
  }
}

export function CategoryWikiDetail({ primary, secondary }: CategoryWikiDetailProps) {
  const openConcept = useAppStore((s) => s.openConcept);
  const [wiki, setWiki] = useState<CategoryWiki | null>(null);
  const [loading, setLoading] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<CategoryWikiRunStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTocId, setActiveTocId] = useState<string | null>(null);
  const [runs, setRuns] = useState<CategoryWikiRunSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const mermaidRenderedRef = useRef(false);
  const autoTriggeredRef = useRef(false);
  const targetKey = `${primary}\u0000${secondary}`;
  const activeTargetRef = useRef(targetKey);
  activeTargetRef.current = targetKey;

  const concepts = useLiveQuery(
    async () => getDb().concepts.orderBy('updatedAt').reverse().toArray(),
    [],
  );

  const conceptTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!concepts) return map;
    for (const c of concepts) {
      map.set(c.title, c.id);
    }
    return map;
  }, [concepts]);

  const toc = useMemo(() => {
    if (!wiki?.bodyMd) return [];
    return extractTocFromMd(wiki.bodyMd);
  }, [wiki?.bodyMd]);

  const [htmlContent, setHtmlContent] = useState('');
  useEffect(() => {
    if (!wiki?.bodyMd) {
      setHtmlContent('');
      return;
    }
    let cancelled = false;
    const processed = renderMarkdownWithWikilinks(wiki.bodyMd, conceptTitleMap);
    void Promise.all([loadMarked(), loadDOMPurify()]).then(([markedMod, dpMod]) => {
      if (cancelled) return;
      const raw = markedMod ? (markedMod.marked.parse(processed, { async: false }) as string) : '';
      const sanitized = dpMod
        ? dpMod.sanitize(raw, {
            ADD_TAGS: ['span'],
            ADD_ATTR: ['data-wikilink', 'id'],
          })
        : escapeHTML(raw);
      if (!cancelled) setHtmlContent(sanitized);
    });
    return () => {
      cancelled = true;
    };
  }, [wiki?.bodyMd, conceptTitleMap]);

  const fetchWiki = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCategoryWiki(primary, secondary);
      if (activeTargetRef.current !== targetKey) return;
      setWiki(result);
    } catch (err) {
      if (activeTargetRef.current !== targetKey) return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (activeTargetRef.current === targetKey) setLoading(false);
    }
  }, [primary, secondary, targetKey]);

  const fetchRuns = useCallback(async () => {
    try {
      const list = await listCategoryWikiRuns(primary, secondary, HISTORY_LIMIT);
      if (activeTargetRef.current !== targetKey) return;
      setRuns(list);
    } catch {
      // 更新记录是辅助信息，加载失败不打断主流程
    }
  }, [primary, secondary, targetKey]);

  useEffect(() => {
    autoTriggeredRef.current = false;
    mermaidRenderedRef.current = false;
    setRunId(null);
    setRunStatus(null);
    setError(null);
    setHistoryOpen(false);
    fetchWiki();
    fetchRuns();
  }, [fetchWiki, fetchRuns]);

  const startGenerateRun = useCallback(async () => {
    try {
      const start = await createCategoryWikiRun(primary, secondary);
      setRunId(start.runId);
      setRunStatus(null);
      fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建生成任务失败');
    }
  }, [primary, secondary, fetchRuns]);

  useEffect(() => {
    if (loading) return;
    if (runId) return;
    if (autoTriggeredRef.current) return;
    const needsGenerate = !wiki || wiki.stale;
    if (!needsGenerate) return;
    autoTriggeredRef.current = true;
    setError(null);
    void startGenerateRun();
  }, [loading, runId, wiki, startGenerateRun]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const status = await getCategoryWikiRunStatus(runId);
        if (cancelled) return;
        setRunStatus(status);
        if (status.status === 'done') {
          setRunId(null);
          setRunStatus(null);
          mermaidRenderedRef.current = false;
          await fetchWiki();
          fetchRuns();
          return;
        }
        if (status.status === 'failed') {
          setError(status.error || '生成失败');
          setRunId(null);
          setRunStatus(null);
          fetchRuns();
          return;
        }
      } catch {
        if (cancelled) return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, fetchWiki, fetchRuns]);

  useEffect(() => {
    if (!htmlContent || !contentRef.current || mermaidRenderedRef.current) return;
    const container = contentRef.current;
    requestAnimationFrame(() => {
      renderMermaidBlocks(container).then(() => {
        mermaidRenderedRef.current = true;
      });
    });
  }, [htmlContent]);

  useEffect(() => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-wikilink]');
      if (!target) return;
      const conceptId = (target as HTMLElement).getAttribute('data-wikilink');
      if (conceptId) {
        e.preventDefault();
        openConcept(conceptId);
      }
    };
    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [openConcept]);

  useEffect(() => {
    if (!contentRef.current || toc.length === 0) return;
    const container = contentRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    for (const item of toc) {
      const el = container.querySelector(`#${CSS.escape(item.id)}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [toc]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    setRunId(null);
    setRunStatus(null);
    autoTriggeredRef.current = true;
    await startGenerateRun();
  }, [startGenerateRun]);

  const isGenerating = runId !== null;
  const showContent = Boolean(wiki?.bodyMd);
  const waitingForFirstRun = !wiki && isGenerating;

  if (loading && !wiki && !runId) {
    return (
      <div className="category-wiki-detail">
        <div className="category-wiki-detail-loading" role="status">
          <span className="status-dot" />
          加载中...
        </div>
      </div>
    );
  }

  return (
    <div className="category-wiki-detail">
      <header className="category-wiki-detail-header">
        <div className="category-wiki-detail-title-row">
          <h1 className="category-wiki-detail-title">{secondary}</h1>
          <span className="category-wiki-detail-badge">Wiki</span>
        </div>
        <div className="category-wiki-detail-meta">
          <span>
            {primary} › {secondary}
          </span>
          {wiki && !isGenerating && (
            <>
              <span>·</span>
              <span>{formatRelativeTime(wiki.generatedAt)}生成</span>
              {wiki.stale && <span className="category-wiki-detail-stale">内容有更新</span>}
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="category-wiki-detail-error" role="alert">
          <span>{error}</span>
          <button className="modal-btn" type="button" onClick={handleGenerate}>
            重试
          </button>
        </div>
      )}

      {waitingForFirstRun && !error && (
        <CategoryWikiLoader
          variant="first-run"
          secondary={secondary}
          phase={runStatus?.phase ?? 'queued'}
        />
      )}

      {!showContent && !isGenerating && !error && (
        <div className="category-wiki-detail-empty">
          <p>暂无 Wiki 内容。</p>
          <button className="modal-btn primary" type="button" onClick={handleGenerate}>
            <span className="category-wiki-detail-empty-icon">
              <Icon.Sparkle />
            </span>
            立即生成
          </button>
        </div>
      )}

      {wiki?.stale && showContent && isGenerating && (
        <div className="category-wiki-detail-stale-banner" role="status">
          <span className="category-wiki-detail-stale-banner-spinner" aria-hidden="true" />
          <span>
            相关概念有更新，AI 正在自动重新生成... ({PHASE_LABEL[runStatus?.phase ?? 'queued']})
          </span>
        </div>
      )}

      {showContent && isGenerating && !wiki?.stale && (
        <div className="category-wiki-detail-stale-banner" role="status">
          <span className="category-wiki-detail-stale-banner-spinner" aria-hidden="true" />
          <span>AI 正在重新生成... ({PHASE_LABEL[runStatus?.phase ?? 'queued']})</span>
        </div>
      )}

      {showContent && (
        <div className="category-wiki-detail-body">
          {toc.length > 0 && (
            <nav className="category-wiki-detail-toc" aria-label="目录">
              {toc.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`category-wiki-detail-toc-item level-${item.level}${activeTocId === item.id ? ' active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = contentRef.current?.querySelector(`#${CSS.escape(item.id)}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {item.title}
                </a>
              ))}
            </nav>
          )}
          <div
            className="category-wiki-detail-content prose"
            ref={contentRef}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </div>
      )}

      {(showContent || runs.length > 0) && (
        <footer className="category-wiki-detail-footer">
          <button
            type="button"
            className="category-wiki-detail-history-toggle"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen}
          >
            <span>更新记录{runs.length > 0 ? `（${runs.length}）` : ''}</span>
            <span aria-hidden="true">{historyOpen ? '−' : '+'}</span>
          </button>
          {historyOpen && (
            <div className="category-wiki-detail-history">
              {runs.length === 0 ? (
                <p className="category-wiki-detail-history-empty">暂无生成记录。</p>
              ) : (
                <ul className="category-wiki-detail-history-list">
                  {runs.map((run) => (
                    <li
                      key={run.runId}
                      className={`category-wiki-detail-history-item category-wiki-detail-history-item--${run.status}`}
                    >
                      <span className="category-wiki-detail-history-status">
                        {RUN_STATUS_LABEL[run.status]}
                        {run.status === 'running' && `（${PHASE_LABEL[run.phase]}）`}
                      </span>
                      <span className="category-wiki-detail-history-time">
                        {formatRelativeTime(run.startedAt)}
                      </span>
                      {run.status === 'failed' && run.error && (
                        <span className="category-wiki-detail-history-error" title={run.error}>
                          {run.error.slice(0, 80)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {showContent && (
                <div className="category-wiki-detail-history-actions">
                  <button
                    className="modal-btn"
                    type="button"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? '生成中...' : '✨ 手动重新生成'}
                  </button>
                </div>
              )}
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

interface CategoryWikiLoaderProps {
  variant: 'first-run';
  secondary: string;
  phase: CategoryWikiRunPhase;
}

function CategoryWikiLoader({ secondary, phase }: CategoryWikiLoaderProps) {
  const currentIdx = Math.max(0, PROGRESS_PHASES.indexOf(phase));
  return (
    <div className="category-wiki-loader" role="status" aria-live="polite">
      <div className="category-wiki-loader-card">
        <div className="category-wiki-loader-icon" aria-hidden="true">
          <Icon.Sparkle />
        </div>
        <h2 className="category-wiki-loader-title">AI 正在为「{secondary}」生成 Wiki</h2>
        <p className="category-wiki-loader-subtitle">{PHASE_DESCRIPTION[phase]}</p>
        <ol className="category-wiki-loader-steps">
          {PROGRESS_PHASES.map((p, idx) => {
            const status = idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending';
            return (
              <li
                key={p}
                className={`category-wiki-loader-step category-wiki-loader-step--${status}`}
              >
                <span className="category-wiki-loader-step-dot" aria-hidden="true" />
                <span className="category-wiki-loader-step-label">{PHASE_LABEL[p]}</span>
              </li>
            );
          })}
        </ol>
        <p className="category-wiki-loader-hint">首次生成约需 15–30 秒</p>
      </div>
    </div>
  );
}
