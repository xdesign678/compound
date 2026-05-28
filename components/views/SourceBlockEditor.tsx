'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { SourceBlock } from '@/lib/markdown-editor/block-split';

interface SourceBlockEditorProps {
  blocks: SourceBlock[];
  onBlocksChange: (next: SourceBlock[]) => void;
  onCommit: (id: string, raw: string) => void;
  registerTextareaRef: (id: string, el: HTMLTextAreaElement | null) => void;
  renderBlockHtml: (block: SourceBlock) => string;
  editable: boolean;
  onActiveBlockChange?: (id: string | null) => void;
}

function BlockItem({
  block,
  isActive,
  editable,
  html,
  onEnterEdit,
  onCommitBlock,
  onChangeRaw,
  registerRef,
}: {
  block: SourceBlock;
  isActive: boolean;
  editable: boolean;
  html: string;
  onEnterEdit: (block: SourceBlock) => void;
  onCommitBlock: (id: string, raw: string) => void;
  onChangeRaw: (id: string, raw: string) => void;
  registerRef: (id: string, el: HTMLTextAreaElement | null) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [localValue, setLocalValue] = useState(block.raw);

  // Keep local value in sync when block.raw changes externally
  useEffect(() => {
    setLocalValue(block.raw);
  }, [block.raw]);

  // Auto-resize when entering edit mode or when value changes
  useEffect(() => {
    if (isActive && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [isActive, localValue]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!editable || isActive) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('a') ||
        target.closest('[data-concept-id]') ||
        target.closest('[data-wikilink]') ||
        target.closest('.content-tags')
      ) {
        return;
      }
      onEnterEdit(block);
    },
    [editable, isActive, onEnterEdit, block],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setLocalValue(next);
      onChangeRaw(block.id, next);
      // Auto-resize
      const el = e.target;
      el.style.height = '0px';
      el.style.height = `${el.scrollHeight}px`;
    },
    [block.id, onChangeRaw],
  );

  const commitCurrentValue = useCallback(() => {
    onCommitBlock(block.id, textareaRef.current?.value ?? localValue);
  }, [block.id, localValue, onCommitBlock]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        commitCurrentValue();
      }
    },
    [commitCurrentValue],
  );

  const setTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      registerRef(block.id, el);
    },
    [block.id, registerRef],
  );

  // Skip non-renderable blocks
  if (block.kind === 'frontmatter-tags' || block.kind === 'leading-title') {
    return null;
  }

  return (
    <div
      className={`source-block${isActive ? ' is-editing' : ''}`}
      role="group"
      aria-label={block.type === 'heading' ? '标题块' : '内容块'}
      onClick={handleClick}
      id={block.type === 'heading' ? block.id : undefined}
    >
      <div
        className="source-block-render prose"
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ display: isActive ? 'none' : undefined }}
      />
      {isActive && (
        <textarea
          ref={setTextareaRef}
          className="source-block-textarea"
          value={localValue}
          onChange={handleChange}
          onBlur={commitCurrentValue}
          onKeyDown={handleKeyDown}
          autoFocus
          spellCheck={false}
          aria-label="编辑内容块"
          data-source-block-textarea
        />
      )}
    </div>
  );
}

const MemoBlockItem = memo(BlockItem);

export function SourceBlockEditor({
  blocks,
  onBlocksChange,
  onCommit,
  registerTextareaRef,
  renderBlockHtml,
  editable,
  onActiveBlockChange,
}: SourceBlockEditorProps) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  const enterEdit = useCallback(
    (block: SourceBlock) => {
      setActiveBlockId(block.id);
      onActiveBlockChange?.(block.id);
    },
    [onActiveBlockChange],
  );

  const commit = useCallback(
    (id: string, raw: string) => {
      setActiveBlockId(null);
      onActiveBlockChange?.(null);
      onCommit(id, raw);
    },
    [onActiveBlockChange, onCommit],
  );

  const handleChangeRaw = useCallback(
    (id: string, raw: string) => {
      const next = blocks.map((b) => (b.id === id ? { ...b, raw } : b));
      onBlocksChange(next);
    },
    [blocks, onBlocksChange],
  );

  return (
    <div className="source-block-editor">
      {blocks.map((block) => (
        <MemoBlockItem
          key={block.id}
          block={block}
          isActive={activeBlockId === block.id}
          editable={editable}
          html={renderBlockHtml(block)}
          onEnterEdit={enterEdit}
          onCommitBlock={commit}
          onChangeRaw={handleChangeRaw}
          registerRef={registerTextareaRef}
        />
      ))}
    </div>
  );
}
