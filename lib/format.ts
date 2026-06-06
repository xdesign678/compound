// marked and dompurify are lazy-loaded to keep them out of the first-screen
// shared bundle. They are loaded on first call to renderMarkdown / loadMarked /
// loadDOMPurify, then cached at module level for instant subsequent access.
// Pattern follows the mermaid lazy-load in CategoryWikiDetail.tsx.

const DEFAULT_BREAKS = false;

function readBreaksPref(): boolean {
  if (typeof window === 'undefined') return DEFAULT_BREAKS;
  const raw = localStorage.getItem('compound_markdown_breaks');
  return raw === '1';
}

// ---------------------------------------------------------------------------
// Lazy loaders for marked & dompurify
// ---------------------------------------------------------------------------

type MarkedModule = typeof import('marked');
let _markedModule: MarkedModule | null = null;
let _markedLoadPromise: Promise<MarkedModule | null> | null = null;

/** Lazy-load the `marked` module (code-split into its own chunk). */
export async function loadMarked(): Promise<MarkedModule | null> {
  if (_markedModule) return _markedModule;
  if (_markedLoadPromise) return _markedLoadPromise;
  _markedLoadPromise = import('marked')
    .then((mod) => {
      _markedModule = mod;
      mod.marked.setOptions({ gfm: true, breaks: readBreaksPref() });
      return mod;
    })
    .catch(() => null);
  return _markedLoadPromise;
}

// dompurify's module shape varies by bundler/runtime (default export as callable
// vs namespace object). We use a structural type to avoid esModuleInterop quirks.
interface DOMPurifyModuleShape {
  sanitize: (source: string, config?: Record<string, unknown>) => string;
}

let _dompurifyModule: DOMPurifyModuleShape | null = null;
let _dompurifyLoadPromise: Promise<DOMPurifyModuleShape | null> | null = null;

/** Lazy-load the `dompurify` module (code-split into its own chunk). */
export async function loadDOMPurify(): Promise<DOMPurifyModuleShape | null> {
  if (_dompurifyModule) return _dompurifyModule;
  if (_dompurifyLoadPromise) return _dompurifyLoadPromise;
  _dompurifyLoadPromise = import('dompurify')
    .then((mod) => {
      // mod.default is the DOMPurify sanitizer (callable with .sanitize etc.)
      const sanitizer = (mod as Record<string, unknown>).default;
      if (
        sanitizer &&
        typeof sanitizer === 'object' &&
        typeof (sanitizer as Record<string, unknown>).sanitize === 'function'
      ) {
        _dompurifyModule = sanitizer as DOMPurifyModuleShape;
      }
      return _dompurifyModule;
    })
    .catch(() => null);
  return _dompurifyLoadPromise;
}

// ---------------------------------------------------------------------------
// Markdown break preference
// ---------------------------------------------------------------------------

/** Toggle markdown line-break mode and update the marked renderer */
export function setMarkdownBreaks(enabled: boolean) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('compound_markdown_breaks', enabled ? '1' : '0');
  }
  if (_markedModule) {
    _markedModule.marked.setOptions({ breaks: enabled });
  }
}

export function getMarkdownBreaks(): boolean {
  return readBreaksPref();
}

// ---------------------------------------------------------------------------
// renderMarkdown (async — lazily loads marked + dompurify on first call)
// ---------------------------------------------------------------------------

/**
 * Render markdown → HTML, and transform [text](concept:id) into clickable spans
 * that our UI wires to navigation. Also handles [CX] citation footnotes,
 * Obsidian-style [[wiki-links]] and `tags: [a, b, c]` frontmatter chips.
 *
 * Async because marked and dompurify are lazy-loaded on first call; subsequent
 * calls resolve near-instantly from the module-level cache.
 */
export async function renderMarkdown(md: string): Promise<string> {
  const mod = await loadMarked();
  if (!mod) return escapeHTML(md || '');

  const { marked } = mod;
  let source = md || '';

  // 1) Pre-extract Obsidian wiki-links so marked won't mangle them.
  const wikiLinks: Array<{ target: string; alias: string }> = [];
  source = source.replace(
    /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]/g,
    (_match, target: string, alias?: string) => {
      const idx = wikiLinks.length;
      wikiLinks.push({
        target: target.trim(),
        alias: (alias ?? target).trim(),
      });
      return `\u0000WIKILINK${idx}\u0000`;
    },
  );

  // 2) Pre-extract `tags: [a, b, c]` lines as chip rows.
  const tagBlocks: string[][] = [];
  source = source.replace(
    /(^|\n)[\t ]*tags?\s*:\s*\[([^\]\n]*)\][\t ]*(?=\n|$)/gi,
    (_match, lead: string, list: string) => {
      const tags = list
        .split(/[,，]/)
        .map((t) => t.replace(/^["'](.*)["']$/, '$1').trim())
        .filter(Boolean);
      if (tags.length === 0) return _match;
      const idx = tagBlocks.length;
      tagBlocks.push(tags);
      return `${lead}\u0000TAGS${idx}\u0000`;
    },
  );

  let html = marked.parse(source, { async: false }) as string;

  // [text](concept:id) → custom span
  html = html.replace(
    /<a href="concept:([^"]+)"[^>]*>([^<]+)<\/a>/g,
    '<span class="inline-link" data-concept-id="$1">$2</span>',
  );

  // [CX] citation footnotes → pill
  html = html.replace(/\[C(\d+)\]/g, '<span class="citation" data-citation-index="$1">C$1</span>');

  // Restore wiki-link placeholders → clickable spans.
  html = html.replace(/\u0000WIKILINK(\d+)\u0000/g, (_match, idx: string) => {
    const item = wikiLinks[Number(idx)];
    if (!item) return '';
    return `<span class="wikilink" data-wikilink="${escapeHTML(item.target)}" role="link" tabindex="0">${escapeHTML(item.alias)}</span>`;
  });

  // Restore tag-row placeholders → chip lists. Strip surrounding <p> if marked
  // wrapped the placeholder in a paragraph on its own.
  html = html.replace(/<p>\s*\u0000TAGS(\d+)\u0000\s*<\/p>/g, (_match, idx: string) =>
    renderTagsRow(tagBlocks[Number(idx)] ?? []),
  );
  html = html.replace(/\u0000TAGS(\d+)\u0000/g, (_match, idx: string) =>
    renderTagsRow(tagBlocks[Number(idx)] ?? []),
  );

  if (typeof window !== 'undefined') {
    const dpMod = await loadDOMPurify();
    if (dpMod) {
      html = dpMod.sanitize(html, {
        ALLOWED_TAGS: [
          'p',
          'strong',
          'em',
          'ul',
          'ol',
          'li',
          'code',
          'pre',
          'blockquote',
          'h1',
          'h2',
          'h3',
          'h4',
          'span',
          'a',
          'br',
          'hr',
        ],
        ALLOWED_ATTR: [
          'class',
          'data-concept-id',
          'data-citation-index',
          'data-wikilink',
          'href',
          'target',
          'role',
          'tabindex',
        ],
      });
    }
  }

  return html;
}

function renderTagsRow(tags: string[]): string {
  if (tags.length === 0) return '';
  const chips = tags.map((t) => `<span class="content-tag">${escapeHTML(t)}</span>`).join('');
  return `<span class="content-tags">${chips}</span>`;
}

export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} 周前`;
  return `${Math.floor(diff / (30 * day))} 个月前`;
}

export function groupActivityByDate<T extends { at: number }>(
  items: T[],
): Array<{ label: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  const now = Date.now();
  const day = 86400000;

  for (const it of items) {
    const diff = now - it.at;
    let label: string;
    if (diff < day) label = '今天';
    else if (diff < 2 * day) label = '昨天';
    else if (diff < 7 * day) label = '本周';
    else label = '更早';

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(it);
  }

  const order = ['今天', '昨天', '本周', '更早'];
  return order.filter((k) => groups.has(k)).map((label) => ({ label, items: groups.get(label)! }));
}

/** Escape HTML special characters for safe interpolation into HTML strings. */
export function escapeHTML(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
