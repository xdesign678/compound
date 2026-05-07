export type MarkdownEditCommand = 'bold' | 'italic' | 'heading' | 'list' | 'quote';

export interface MarkdownSelectionInput {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  command: MarkdownEditCommand;
}

export interface MarkdownSelectionResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

function wrapSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string,
  placeholder: string,
): MarkdownSelectionResult {
  const selected = value.slice(selectionStart, selectionEnd) || placeholder;
  const next = `${value.slice(0, selectionStart)}${marker}${selected}${marker}${value.slice(
    selectionEnd,
  )}`;
  const start = selectionStart + marker.length;
  return {
    value: next,
    selectionStart: start,
    selectionEnd: start + selected.length,
  };
}

function lineRange(value: string, selectionStart: number, selectionEnd: number) {
  const start = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const nextBreak = value.indexOf('\n', selectionEnd);
  const end = nextBreak === -1 ? value.length : nextBreak;
  return { start, end };
}

function prefixSelectedLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
): MarkdownSelectionResult {
  const range = lineRange(value, selectionStart, selectionEnd);
  const block = value.slice(range.start, range.end);
  const lines = block.length > 0 ? block.split('\n') : [''];
  const nextBlock = lines
    .map((line) => {
      if (!line.trim()) return prefix.trimEnd();
      return line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`;
    })
    .join('\n');
  const next = `${value.slice(0, range.start)}${nextBlock}${value.slice(range.end)}`;
  const delta = nextBlock.length - block.length;
  return {
    value: next,
    selectionStart: selectionStart + (selectionStart === range.start ? prefix.length : 0),
    selectionEnd: Math.max(selectionStart, selectionEnd + delta),
  };
}

function toggleHeading(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownSelectionResult {
  const range = lineRange(value, selectionStart, selectionEnd);
  const block = value.slice(range.start, range.end);
  const lines = block.length > 0 ? block.split('\n') : [''];
  const nextBlock = lines
    .map((line) => {
      if (line.startsWith('## ')) return line.slice(3);
      return `## ${line || '标题'}`;
    })
    .join('\n');
  const next = `${value.slice(0, range.start)}${nextBlock}${value.slice(range.end)}`;
  const delta = nextBlock.length - block.length;
  return {
    value: next,
    selectionStart: selectionStart + (selectionStart === range.start ? 3 : 0),
    selectionEnd: Math.max(selectionStart, selectionEnd + delta),
  };
}

export function applyMarkdownSelectionEdit(input: MarkdownSelectionInput): MarkdownSelectionResult {
  const { value, selectionStart, selectionEnd, command } = input;
  if (command === 'bold') return wrapSelection(value, selectionStart, selectionEnd, '**', '加粗');
  if (command === 'italic') return wrapSelection(value, selectionStart, selectionEnd, '*', '斜体');
  if (command === 'heading') return toggleHeading(value, selectionStart, selectionEnd);
  if (command === 'list') return prefixSelectedLines(value, selectionStart, selectionEnd, '- ');
  return prefixSelectedLines(value, selectionStart, selectionEnd, '> ');
}
