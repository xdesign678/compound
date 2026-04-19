'use client';

import { useRef, useEffect, useState } from 'react';

interface NoteEditorProps {
  onDone: (title: string, content: string) => void;
  onCancel: () => void;
}

function domToMarkdown(el: HTMLElement): string {
  const lines: string[] = [];

  function processInline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    const inner = Array.from(e.childNodes).map(processInline).join('');
    if (tag === 'strong' || tag === 'b') return `**${inner}**`;
    if (tag === 'em' || tag === 'i') return `*${inner}*`;
    if (tag === 'br') return '\n';
    return inner;
  }

  function processBlock(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent?.trim();
      if (t) lines.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const e = node as Element;
    const tag = e.tagName.toLowerCase();
    if (tag === 'h1') { lines.push('# ' + (e.textContent ?? '')); return; }
    if (tag === 'h2') { lines.push('## ' + (e.textContent ?? '')); return; }
    if (tag === 'h3') { lines.push('### ' + (e.textContent ?? '')); return; }
    if (tag === 'blockquote') { lines.push('> ' + (e.textContent ?? '')); return; }
    if (tag === 'ul') {
      e.querySelectorAll(':scope > li').forEach(li => lines.push('- ' + (li.textContent ?? '')));
      return;
    }
    if (tag === 'ol') {
      e.querySelectorAll(':scope > li').forEach((li, i) => lines.push(`${i + 1}. ` + (li.textContent ?? '')));
      return;
    }
    if (tag === 'p' || tag === 'div') {
      if (e.innerHTML === '<br>' || !e.textContent?.trim()) { lines.push(''); return; }
      lines.push(Array.from(e.childNodes).map(processInline).join(''));
      return;
    }
    e.childNodes.forEach(processBlock);
  }

  el.childNodes.forEach(processBlock);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function NoteEditor({ onDone, onCancel }: NoteEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = '<p><br></p>';
    el.focus();

    function getParentBlock(node: Node): Element | null {
      let cur: Node | null = node;
      while (cur && cur !== el) {
        if (cur.nodeType === Node.ELEMENT_NODE) {
          const tag = (cur as Element).tagName;
          if (['P', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'DIV'].includes(tag)) return cur as Element;
        }
        cur = cur.parentNode;
      }
      return null;
    }

    function moveCursorToStart(target: Element) {
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      const first = target.firstChild;
      if (first) range.setStart(first, 0); else range.setStart(target, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function convertBlock(block: Element, tag: string, stripLen: number) {
      const text = (block.textContent ?? '').slice(stripLen);
      if (tag === 'li') {
        const li = document.createElement('li');
        li.textContent = text;
        const ul = document.createElement('ul');
        ul.appendChild(li);
        block.parentNode?.replaceChild(ul, block);
        moveCursorToStart(li);
      } else {
        const newEl = document.createElement(tag);
        newEl.textContent = text;
        if (!text) newEl.innerHTML = '<br>';
        block.parentNode?.replaceChild(newEl, block);
        moveCursorToStart(newEl);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);

      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); document.execCommand('bold'); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); document.execCommand('italic'); return; }

      if (e.key === ' ') {
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return;
        const text = (node.textContent ?? '').slice(0, range.startOffset).trimStart();
        const block = getParentBlock(node);
        if (!block) return;
        if ((block.textContent ?? '').trim() !== (node.textContent ?? '').trim()) return;
        if (text === '#') { e.preventDefault(); convertBlock(block, 'h1', 2); }
        else if (text === '##') { e.preventDefault(); convertBlock(block, 'h2', 3); }
        else if (text === '###') { e.preventDefault(); convertBlock(block, 'h3', 4); }
        else if (text === '-') { e.preventDefault(); convertBlock(block, 'li', 2); }
        else if (text === '>') { e.preventDefault(); convertBlock(block, 'blockquote', 2); }
      }
    }

    function handleInput() {
      setHasContent(!!(editorRef.current?.textContent?.trim()));
    }

    el.addEventListener('keydown', handleKeyDown);
    el.addEventListener('input', handleInput);
    return () => {
      el.removeEventListener('keydown', handleKeyDown);
      el.removeEventListener('input', handleInput);
    };
  }, []);

  function handleDone() {
    const md = domToMarkdown(editorRef.current!);
    if (!md.trim()) return;
    // First non-empty line = title, rest = content
    const allLines = md.split('\n');
    const firstIdx = allLines.findIndex(l => l.trim());
    const title = allLines[firstIdx]?.replace(/^#+\s*/, '').trim() || '无标题';
    const body = allLines.slice(firstIdx + 1).join('\n').trim();
    onDone(title, body ? `${allLines[firstIdx]}\n\n${body}` : md);
  }

  return (
    <div className="note-editor-overlay">
      <div className="note-editor-header">
        <button className="note-editor-cancel" onClick={onCancel}>取消</button>
        <div className="note-editor-toolbar-inline">
          <button className="note-toolbar-btn" onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }} title="粗体 (Ctrl+B)">
            <strong>B</strong>
          </button>
          <button className="note-toolbar-btn" onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }} title="斜体 (Ctrl+I)">
            <em>I</em>
          </button>
        </div>
        <button className={`note-editor-done ${hasContent ? 'enabled' : ''}`} disabled={!hasContent} onClick={handleDone}>
          完成
        </button>
      </div>

      <div className="note-editor-scroll">
        <div className="note-editor-hints">
          <span># 标题</span>
          <span>- 列表</span>
          <span>&gt; 引用</span>
          <span>**粗体**</span>
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="note-editor-content notion-style"
          data-placeholder="开始记录，第一行即标题..."
        />
      </div>
    </div>
  );
}
