'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useAppStore } from '@/lib/store';
import { getCategoryWiki, createCategoryWikiRun, getCategoryWikiRunStatus } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/format';
import { Icon } from '../Icons';
import type {
  CategoryWiki,
  CategoryWikiRunPhase,
  CategoryWikiRunStatusResponse,
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
        securityLevel: 'loose',
      });
      return mod;
    })
    .catch(() => null);
  return mermaidLoadPromise;
}

async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const mermaid = await loadMermaid();
  if (!mermaid) return;

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
      wrapper.innerHTML = svg;
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
  const contentRef = useRef<HTMLDivElement>(null);
  const mermaidRenderedRef = useRef(false);

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

  const htmlContent = useMemo(() => {
    if (!wiki?.bodyMd) return '';
    const processed = renderMarkdownWithWikilinks(wiki.bodyMd, conceptTitleMap);
    const raw = marked(processed) as string;
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['span'],
      ADD_ATTR: ['data-wikilink', 'id'],
    });
  }, [wiki?.bodyMd, conceptTitleMap]);

  const fetchWiki = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCategoryWiki(primary, secondary);
      setWiki(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [primary, secondary]);

  useEffect(() => {
    fetchWiki();
  }, [fetchWiki]);

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
          await fetchWiki();
          return;
        }
        if (status.status === 'failed') {
          setError(status.error || '生成失败');
          setRunId(null);
          setRunStatus(null);
          return;
        }
      } catch (err) {
        if (cancelled) return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, fetchWiki]);

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
    try {
      const start = await createCategoryWikiRun(primary, secondary);
      setRunId(start.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建生成任务失败');
    }
  }, [primary, secondary]);

  const isGenerating = runId !== null && runStatus?.status === 'running';
  const showContent = wiki?.bodyMd && !isGenerating;

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

      {isGenerating && (
        <div className="category-wiki-detail-progress" role="status">
          <span className="status-dot" />
          <span>{PHASE_LABEL[runStatus?.phase ?? 'queued']}</span>
        </div>
      )}

      {error && (
        <div className="category-wiki-detail-error" role="alert">
          <span>{error}</span>
          <button className="modal-btn" type="button" onClick={handleGenerate}>
            重试
          </button>
        </div>
      )}

      {!showContent && !isGenerating && !error && (
        <div className="category-wiki-detail-empty">
          <p>这个主题的 Wiki 还没有生成。</p>
          <p>AI 会综合该主题下所有概念，生成一份完整的主题百科。</p>
          <button className="modal-btn primary" type="button" onClick={handleGenerate}>
            <Icon.Sparkle /> 生成 Wiki
          </button>
        </div>
      )}

      {wiki?.stale && showContent && (
        <div className="category-wiki-detail-stale-banner">
          <span>相关概念有更新，Wiki 内容可能过时</span>
          <button
            className="modal-btn"
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            ✨ 重新生成
          </button>
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

      {showContent && (
        <div className="category-wiki-detail-actions">
          <button
            className="modal-btn"
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            ✨ 重新生成
          </button>
        </div>
      )}
    </div>
  );
}
