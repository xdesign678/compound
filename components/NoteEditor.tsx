'use client';

import { useRef, useEffect, useState } from 'react';

interface NoteEditorProps {
  onDone: (title: string, content: string) => void;
  onCancel: () => void;
}

// Convert the contenteditable DOM back to Markdown text
function domToMarkdown(el: HTMLElement): string {
  let lines: string[] = [];

  function processInline(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(processInline).join('');
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

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'h1') { lines.push('# ' + (el.textContent ?? '')); return; }
    if (tag === 'h2') { lines.push('## ' + (el.textContent ?? '')); return; }
    if (tag === 'h3') { lines.push('### ' + (el.textContent ?? '')); return; }
    if (tag === 'blockquote') { lines.push('> ' + (el.textContent ?? '')); return; }

    if (tag === 'ul') {
      el.querySelectorAll(':scope > li').forEach(li => {
        lines.push('- ' + (li.textContent ?? ''));
      });
      return;
    }
    if (tag === 'ol') {
      el.querySelectorAll(':scope > li').forEach((li, i) => {
        lines.push(`${i + 1}. ` + (li.textContent ?? ''));
      });
      return;
    }

    if (tag === 'p' || tag === 'div') {
      if (el.innerHTML === '<br>' || !el.textContent?.trim()) {
        lines.push('');
        return;
      }
      const inline = Array.from(el.childNodes).map(processInline).join('');
      lines.push(inline);
      return;
    }

    // recurse into unknown elements
    el.childNodes.forEach(processBlock);
  }

  el.childNodes.forEach(processBlock);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function NoteEditor({ onDone, onCancel }: NoteEditorProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [hasTitle, setHasTitle] = useState(false);

  useEffect(() => {
    // Focus title on mount
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const titleEl = titleRef.current;
    const editorEl = editorRef.current;
    if (!titleEl || !editorEl) return;

    editorEl.innerHTML = '<p><br></p>';

    function getParentBlock(node: Node): Element | null {
      let cur: Node | null = node;
      while (cur && cur !== editorEl) {
        if (cur.nodeType === Node.ELEMENT_NODE) {
          const tag = (cur as Element).tagName;
          if (['P', 'H1', 'H2', 'H3', 'LI', 'BLOCKQUOTE', 'DIV'].includes(tag)) {
            return cur as Element;
          }
        }
        cur = cur.parentNode;
      }
      return null;
    }

    function moveCursorToStart(target: Element) {
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      const firstChild = target.firstChild;
      if (firstChild) {
        range.setStart(firstChild, 0);
      } else {
        range.setStart(target, 0);
      }
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function convertBlock(block: Element, tag: string, stripLen: number) {
      const originalText = (block.textContent ?? '').slice(stripLen);
      if (tag === 'li') {
        const newLi = document.createElement('li');
        newLi.textContent = originalText;
        const ul = document.createElement('ul');
        ul.appendChild(newLi);
        block.parentNode?.replaceChild(ul, block);
        moveCursorToStart(newLi);
      } else {
        const newEl = document.createElement(tag);
        newEl.textContent = originalText;
        if (!originalText) newEl.innerHTML = '<br>';
        block.parentNode?.replaceChild(newEl, block);
        moveCursorToStart(newEl);
      }
    }

    function handleTitleKeyDown(e: KeyboardEvent) {
      // Prevent newline in title, Enter jumps to body
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!editorEl) return;
        editorEl.focus();
        // Place cursor at start of editor
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          const firstBlock = editorEl.firstChild;
          if (firstBlock) {
            const firstText = firstBlock.firstChild;
            if (firstText) {
              range.setStart(firstText, 0);
            } else {
              range.setStart(firstBlock, 0);
            }
          } else {
            range.setStart(editorEl as Node, 0);
          }
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }

    function handleTitleInput() {
      setHasTitle(!!(titleRef.current?.textContent?.trim()));
    }

    function handleEditorKeyDown(e: KeyboardEvent) {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);

      // Bold / Italic shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        document.execCommand('bold');
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
        e.preventDefault();
        document.execCommand('italic');
        return;
      }

      // Markdown block shortcuts on Space
      if (e.key === ' ') {
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) return;

        const cursorPos = range.startOffset;
        const text = (node.textContent ?? '').slice(0, cursorPos).trimStart();

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

    titleEl.addEventListener('keydown', handleTitleKeyDown);
    titleEl.addEventListener('input', handleTitleInput);
    editorEl.addEventListener('keydown', handleEditorKeyDown);
    return () => {
      titleEl.removeEventListener('keydown', handleTitleKeyDown);
      titleEl.removeEventListener('input', handleTitleInput);
      editorEl.removeEventListener('keydown', handleEditorKeyDown);
    };
  }, []);

  function handleDone() {
    const title = titleRef.current?.textContent?.trim() || '';
    if (!title) return;
    const content = domToMarkdown(editorRef.current!);
    onDone(title, content || title);
  }

  return (
    <div className="note-editor-overlay">
      <div className="note-editor-header">
        <button className="note-editor-cancel" onClick={onCancel}>取消</button>
        <div className="note-editor-toolbar-inline">
          <button
            className="note-toolbar-btn"
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }}
            title="粗体 (Ctrl+B)"
          >
            <strong>B</strong>
          </button>
          <button
            className="note-toolbar-btn"
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }}
            title="斜体 (Ctrl+I)"
          >
            <em>I</em>
          </button>
        </div>
        <button
          className={`note-editor-done ${hasTitle ? 'enabled' : ''}`}
          disabled={!hasTitle}
          onClick={handleDone}
        >
          完成
        </button>
      </div>

      <div className="note-editor-scroll">
        <div
          ref={titleRef}
          contentEditable
          suppressContentEditableWarning
          className="note-editor-title-inline"
          data-placeholder="无标题"
          spellCheck={false}
        />

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
          className="note-editor-content"
          data-placeholder="开始输入..."
        />
      </div>
    </div>
  );
}
