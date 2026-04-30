'use client';

import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { renderMarkdown } from '@/lib/format';
import { useAppStore } from '@/lib/store';
import { getDb } from '@/lib/db';

async function resolveWikiLink(
  title: string,
): Promise<{ kind: 'source' | 'concept'; id: string } | null> {
  if (!title) return null;
  const trimmed = title.trim();
  if (!trimmed) return null;
  const db = getDb();
  const source = await db.sources.filter((s) => s.title === trimmed).first();
  if (source) return { kind: 'source', id: source.id };
  const concept = await db.concepts.filter((c) => c.title === trimmed).first();
  if (concept) return { kind: 'concept', id: concept.id };
  return null;
}

// 判断 href 是否是可直接打开的"真实外链"（http/https/protocol-relative）。
// 站内相对路径(/wiki/xxx)和伪协议(wiki:xxx, concept:xxx)都不算,走 wiki-link 兜底。
function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(href);
}

// mailto/tel/sms 等允许浏览器默认行为。
function isSpecialScheme(href: string): boolean {
  return /^(mailto:|tel:|sms:)/i.test(href);
}

/**
 * Renders markdown and wires up inline concept links / citation pills
 * to the app store navigation.
 */
export function Prose({
  markdown,
  citedConceptIds,
  className,
}: {
  markdown: string;
  citedConceptIds?: string[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const openConcept = useAppStore((s) => s.openConcept);
  const openSource = useAppStore((s) => s.openSource);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const activate = (target: HTMLElement, event?: Event) => {
      const conceptEl = target.closest('[data-concept-id]') as HTMLElement | null;
      if (conceptEl) {
        const id = conceptEl.dataset.conceptId;
        if (id) openConcept(id);
        return;
      }
      const wikiEl = target.closest('[data-wikilink]') as HTMLElement | null;
      if (wikiEl) {
        const title = wikiEl.dataset.wikilink || '';
        void resolveWikiLink(title).then((hit) => {
          if (!hit) {
            showToast(`未找到 "${title}"`, false, true);
            return;
          }
          if (hit.kind === 'source') openSource(hit.id);
          else openConcept(hit.id);
        });
        return;
      }
      const citEl = target.closest('[data-citation-index]') as HTMLElement | null;
      if (citEl && citedConceptIds) {
        const idx = Number(citEl.dataset.citationIndex) - 1;
        const id = citedConceptIds[idx];
        if (id) openConcept(id);
        return;
      }
      // 普通 <a> 兜底:本项目是 SPA,没有 /wiki/* /concept/* 路由,默认跳转必 404。
      // 外链用新标签打开;其他一律按 wiki-link 行为,用链接文本去查本地库。
      const anchorEl = target.closest('a') as HTMLAnchorElement | null;
      if (anchorEl) {
        const rawHref = anchorEl.getAttribute('href') || '';
        const href = rawHref.trim();
        const text = (anchorEl.textContent || '').trim();
        if (!href) {
          event?.preventDefault();
          return;
        }
        if (isSpecialScheme(href)) {
          // mailto/tel/sms: 交给浏览器默认行为。
          return;
        }
        event?.preventDefault();
        if (isExternalHref(href)) {
          try {
            const url = href.startsWith('//') ? `https:${href}` : href;
            window.open(url, '_blank', 'noopener,noreferrer');
          } catch {
            showToast('打开链接失败', false, true);
          }
          return;
        }
        // 站内相对路径 / 伪协议 / hash → 按 wiki-link 查找同名概念。
        if (!text) {
          showToast('链接无对应内容', false, true);
          return;
        }
        void resolveWikiLink(text).then((hit) => {
          if (!hit) {
            showToast(`未找到 "${text}"`, false, true);
            return;
          }
          if (hit.kind === 'source') openSource(hit.id);
          else openConcept(hit.id);
        });
      }
    };

    const clickHandler = (e: Event) => activate(e.target as HTMLElement, e);

    const keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const target = e.target as HTMLElement;
        if (
          target.closest('[data-concept-id]') ||
          target.closest('[data-citation-index]') ||
          target.closest('[data-wikilink]') ||
          target.closest('a')
        ) {
          e.preventDefault();
          activate(target, e);
        }
      }
    };

    el.addEventListener('click', clickHandler);
    el.addEventListener('keydown', keydownHandler);

    el.querySelectorAll<HTMLElement>(
      '[data-concept-id], [data-citation-index], [data-wikilink]',
    ).forEach((node) => {
      node.setAttribute('role', 'link');
      node.setAttribute('tabindex', '0');
    });

    return () => {
      el.removeEventListener('click', clickHandler);
      el.removeEventListener('keydown', keydownHandler);
    };
  }, [openConcept, openSource, showToast, citedConceptIds, markdown]);

  return (
    <div
      ref={ref}
      className={className ? `prose ${className}` : 'prose'}
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(markdown)) }}
    />
  );
}
