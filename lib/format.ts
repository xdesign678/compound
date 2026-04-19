import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Render markdown → HTML, and transform [text](concept:id) into clickable spans
 * that our UI wires to navigation. Also handles [CX] citation footnotes.
 */
export function renderMarkdown(md: string): string {
  let html = marked.parse(md || '', { async: false }) as string;

  // [text](concept:id) → custom span
  html = html.replace(
    /<a href="concept:([^"]+)"[^>]*>([^<]+)<\/a>/g,
    '<span class="inline-link" data-concept-id="$1">$2</span>'
  );

  // [CX] citation footnotes → pill
  html = html.replace(
    /\[C(\d+)\]/g,
    '<span class="citation" data-citation-index="$1">C$1</span>'
  );

  return html;
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

export function groupActivityByDate<T extends { at: number }>(items: T[]): Array<{ label: string; items: T[] }> {
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
