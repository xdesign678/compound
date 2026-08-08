const BLOCK_MARKDOWN_PATTERN = /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|~~~|\|.+\||---\s*$)/m;

/* 兼容存量数据：中英文混排时 `**"…"**` 这类写法里，`**` 紧贴中文/引号，
   按 CommonMark 规则不构成强调，渲染时会露出裸星号。这里把引号提到 `**`
   外面（`看作**"X"**` → `看作"**X**"`），让存量正文恢复为真正的加粗。
   注意这是一种启发式修复：前置字符必须是字母/数字（即 CommonMark 下
   左 flanking 失败的场景），且 inner 不跨行、不含 `*`。 */
const QUOTED_STRONG_PATTERN =
  /([\p{L}\p{N}])(\*\*)(["'“‘「『《])([^*\n]{1,80}?)(["'”’」』》])\*\*/gu;

function hoistQuotedStrong(text: string): string {
  return text.replace(
    QUOTED_STRONG_PATTERN,
    (_match, prev: string, _stars: string, open: string, inner: string, close: string) =>
      `${prev}${open}**${inner}**${close}`,
  );
}

function splitPlainTextIntoSentences(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();

  if (!normalized) return [];

  return (normalized.match(/[^。！？!?；;]+(?:[。！？!?；;]+|$)/g) ?? [normalized])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function formatConceptBodyForDisplay(markdown: string): string {
  const normalized = hoistQuotedStrong(markdown.replace(/\r\n/g, '\n').trim());
  if (!normalized) return '';

  if (/\n\s*\n/.test(normalized) || BLOCK_MARKDOWN_PATTERN.test(normalized)) {
    return normalized;
  }

  const sentences = splitPlainTextIntoSentences(normalized);
  if (sentences.length < 3 || normalized.length < 140) {
    return normalized;
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    paragraphs.push(current.join(' ').trim());
    current = [];
    currentLength = 0;
  };

  for (const sentence of sentences) {
    current.push(sentence);
    currentLength += sentence.length;

    const endsWithStop = /[。！？!?]$/.test(sentence);
    const endsWithSoftStop = /[；;]$/.test(sentence);
    const shouldFlush =
      currentLength >= 150 ||
      (endsWithStop && currentLength >= 96) ||
      (endsWithSoftStop && currentLength >= 84) ||
      current.length >= 3;

    if (shouldFlush) {
      flush();
    }
  }

  flush();

  return paragraphs.length > 1 ? paragraphs.join('\n\n') : normalized;
}
