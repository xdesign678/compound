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

    const activate = (target: HTMLElement) => {
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
      }
    };

    const clickHandler = (e: Event) => activate(e.target as HTMLElement);

    const keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const target = e.target as HTMLElement;
        if (
          target.closest('[data-concept-id]') ||
          target.closest('[data-citation-index]') ||
          target.closest('[data-wikilink]')
        ) {
          e.preventDefault();
          activate(target);
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
