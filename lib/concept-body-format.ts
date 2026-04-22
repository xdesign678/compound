const BLOCK_MARKDOWN_PATTERN =
  /(^|\n)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s|```|~~~|\|.+\||---\s*$)/m;

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
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
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
