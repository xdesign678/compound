import { marked, type Token } from 'marked';

export interface SourceBlock {
  id: string;
  raw: string;
  type: string;
  kind: 'frontmatter-tags' | 'leading-title' | 'normal';
  depth?: number;
}

function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function isFrontmatterTags(raw: string): boolean {
  return /^\s*tags?\s*:\s*\[[^\]]*\]\s*$/i.test(raw);
}

function getTokenText(token: Token): string {
  if ('text' in token && typeof token.text === 'string') {
    return token.text;
  }
  // For tokens without direct text (like some list or blockquote structures),
  // try to extract from nested tokens if available
  if ('tokens' in token && Array.isArray(token.tokens)) {
    const first = token.tokens[0];
    if (first && 'text' in first && typeof first.text === 'string') {
      return first.text;
    }
  }
  return '';
}

export function splitMarkdownBlocks(md: string, sourceTitle: string): SourceBlock[] {
  const tokens = marked.lexer(md);
  const blocks: SourceBlock[] = [];
  let foundLeadingTitle = false;
  const trimmedTitle = sourceTitle.trim();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const raw = token.raw ?? '';
    const type = token.type;

    let kind: SourceBlock['kind'] = 'normal';

    // Detect frontmatter tags (may be wrapped in a paragraph by marked)
    if (isFrontmatterTags(raw)) {
      kind = 'frontmatter-tags';
    }

    // Detect leading title: first heading depth=1 with matching text
    if (
      !foundLeadingTitle &&
      kind === 'normal' &&
      type === 'heading' &&
      'depth' in token &&
      token.depth === 1 &&
      trimmedTitle
    ) {
      const text = getTokenText(token).trim();
      if (text === trimmedTitle) {
        kind = 'leading-title';
        foundLeadingTitle = true;
      }
    }

    // Space tokens are still blocks (they carry newlines), keep them
    // so joinBlocksToMarkdown can reconstruct the exact text.
    const id = `${simpleHash(raw)}-${i}`;
    const depth = type === 'heading' && 'depth' in token ? (token.depth as number) : undefined;
    blocks.push({ id, raw, type, kind, depth });
  }

  return blocks;
}

export function joinBlocksToMarkdown(blocks: SourceBlock[]): string {
  return blocks.map((b) => b.raw).join('');
}

export function extractFrontmatterTags(blocks: SourceBlock[]): string[] {
  for (const block of blocks) {
    if (block.kind === 'frontmatter-tags') {
      const match = block.raw.match(/^\s*tags?\s*:\s*\[([^\]]*)\]/i);
      if (match) {
        return match[1]
          .split(/[,，]/)
          .map((t) => t.replace(/^["'](.*)["']$/, '$1').trim())
          .filter(Boolean);
      }
    }
  }
  return [];
}

export function replaceBlockRaw(
  blocks: SourceBlock[],
  blockId: string,
  newRaw: string,
): SourceBlock[] {
  return blocks.map((b) => (b.id === blockId ? { ...b, raw: newRaw } : b));
}
