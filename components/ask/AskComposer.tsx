'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { LlmConfig } from '../../lib/types';
import { Icon, SourceTypeIcon } from '../Icons';
import type { MentionItem, MentionKind, ModelOption } from './types';

const INLINE_LISTBOX_ID = 'ask-inline-mention-listbox';

export function AskComposer({
  input,
  setInput,
  loading,
  selectedMentions,
  setSelectedMentions,
  referencePickerOpen,
  setReferencePickerOpen,
  referenceMode,
  setReferenceMode,
  pickerSearch,
  setPickerSearch,
  pickerResults,
  inlineResults,
  inlineHighlight,
  setInlineHighlight,
  dismissInlinePanel,
  modelMenuOpen,
  setModelMenuOpen,
  llmConfig,
  mounted,
  showInlinePanel,
  currentModelLabel,
  modelOptions,
  textareaRef,
  composerRef,
  pickerSearchRef,
  autoResize,
  setCaretPosition,
  onSelectMention,
  onRemoveMention,
  onToggleReferencePicker,
  onSelectModel,
  onSend,
}: {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  loading: boolean;
  selectedMentions: MentionItem[];
  setSelectedMentions: Dispatch<SetStateAction<MentionItem[]>>;
  referencePickerOpen: boolean;
  setReferencePickerOpen: Dispatch<SetStateAction<boolean>>;
  referenceMode: MentionKind;
  setReferenceMode: Dispatch<SetStateAction<MentionKind>>;
  pickerSearch: string;
  setPickerSearch: Dispatch<SetStateAction<string>>;
  pickerResults: MentionItem[];
  inlineResults: MentionItem[];
  inlineHighlight: number;
  setInlineHighlight: Dispatch<SetStateAction<number>>;
  dismissInlinePanel: () => void;
  modelMenuOpen: boolean;
  setModelMenuOpen: Dispatch<SetStateAction<boolean>>;
  llmConfig: LlmConfig;
  mounted: boolean;
  showInlinePanel: boolean;
  currentModelLabel: string;
  modelOptions: ModelOption[];
  textareaRef: RefObject<HTMLTextAreaElement>;
  composerRef: RefObject<HTMLDivElement>;
  pickerSearchRef: RefObject<HTMLInputElement>;
  autoResize: () => void;
  setCaretPosition: Dispatch<SetStateAction<number>>;
  onSelectMention: (item: MentionItem, source: 'picker' | 'inline') => void;
  onRemoveMention: (item: MentionItem) => void;
  onToggleReferencePicker: () => void;
  onSelectModel: (model: string) => void;
  onSend: (overrideText?: string) => void | Promise<void>;
}) {
  // Notify ViewportObserver when the ask-input-bar mounts/unmounts.
  // This replaces the former global subtree MutationObserver that fired
  // on every DOM change just to detect this element.
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('ask-input-bar:mount'));
    return () => {
      document.dispatchEvent(new CustomEvent('ask-input-bar:unmount'));
    };
  }, []);

  // 弹层关闭后把焦点还给对应的触发按钮（Escape/背板点击关闭时焦点会掉到 body）
  const referenceBtnRef = useRef<HTMLButtonElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const prevPickerOpen = useRef(false);
  const prevModelOpen = useRef(false);
  // combobox 模式：aria-activedescendant 必须挂在获焦点的 textarea 上，
  // 指向内联 @ 面板里当前高亮的 option（高亮索引按扁平 inlineResults 顺序）
  const inlineActiveDescendant =
    showInlinePanel && inlineResults.length > 0
      ? `mention-option-${inlineResults[inlineHighlight % inlineResults.length]?.kind}-${inlineResults[inlineHighlight % inlineResults.length]?.id}`
      : undefined;
  useEffect(() => {
    if (prevPickerOpen.current && !referencePickerOpen) {
      referenceBtnRef.current?.focus({ preventScroll: true });
    }
    prevPickerOpen.current = referencePickerOpen;
  }, [referencePickerOpen]);
  useEffect(() => {
    if (prevModelOpen.current && !modelMenuOpen) {
      modelBtnRef.current?.focus({ preventScroll: true });
    }
    prevModelOpen.current = modelMenuOpen;
  }, [modelMenuOpen]);

  return (
    <div className="ask-input-bar">
      <div className="ask-input-inner">
        <div
          className={`ask-composer-card${referencePickerOpen || modelMenuOpen || showInlinePanel ? ' is-engaged' : ''}${input.trim() ? ' has-input' : ''}`}
          ref={composerRef}
        >
          {selectedMentions.length > 0 && (
            <div className="ask-mentions-row">
              {selectedMentions.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  className={`ask-mention-chip ${item.kind === 'source' ? 'is-source' : ''}`}
                  onClick={() => onRemoveMention(item)}
                  type="button"
                  aria-label={`移除引用 ${item.title}`}
                >
                  <span className="ask-mention-chip-kind">
                    {item.kind === 'concept' ? '@概念' : '@文件'}
                  </span>
                  <span className="ask-mention-chip-title">{item.title}</span>
                  <span className="ask-mention-chip-close">×</span>
                </button>
              ))}
            </div>
          )}

          {referencePickerOpen &&
            mounted &&
            createPortal(
              <ReferencePicker
                referenceMode={referenceMode}
                setReferenceMode={setReferenceMode}
                pickerSearch={pickerSearch}
                setPickerSearch={setPickerSearch}
                pickerResults={pickerResults}
                pickerSearchRef={pickerSearchRef}
                onClose={() => setReferencePickerOpen(false)}
                onSelect={(item) => onSelectMention(item, 'picker')}
              />,
              document.body,
            )}

          {modelMenuOpen &&
            mounted &&
            createPortal(
              <ModelSelector
                modelOptions={modelOptions}
                activeModel={llmConfig.model}
                onClose={() => setModelMenuOpen(false)}
                onSelectModel={onSelectModel}
              />,
              document.body,
            )}

          {showInlinePanel && (
            <div className="ask-flyout ask-inline-flyout">
              <div className="ask-inline-tip">输入 `@` 可以直接搜索概念或文件，↑↓ 选择</div>
              <MentionResults
                items={inlineResults}
                emptyLabel="没有找到可引用内容"
                highlightIndex={inlineHighlight}
                onSelect={(item) => onSelectMention(item, 'inline')}
              />
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="ask-textarea"
            name="ask-question"
            aria-label="输入问题"
            placeholder="问点什么… 输入 @ 引用概念或资料"
            rows={1}
            role="combobox"
            aria-expanded={showInlinePanel}
            aria-controls={showInlinePanel ? INLINE_LISTBOX_ID : undefined}
            aria-activedescendant={inlineActiveDescendant}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setCaretPosition(event.target.selectionStart);
              autoResize();
            }}
            onClick={(event) =>
              setCaretPosition((event.target as HTMLTextAreaElement).selectionStart)
            }
            onKeyUp={(event) =>
              setCaretPosition((event.target as HTMLTextAreaElement).selectionStart)
            }
            onSelect={(event) =>
              setCaretPosition((event.target as HTMLTextAreaElement).selectionStart)
            }
            onKeyDown={(event) => {
              // IME 组合输入期间（中文输入法选字）不响应 Enter/Backspace 快捷键，
              // 否则拼音候选窗按 Enter 上屏会把未打完的句子直接发出去
              if (event.nativeEvent.isComposing) return;
              const preferredMention = showInlinePanel ? inlineResults[inlineHighlight] : null;
              if (showInlinePanel && event.key === 'ArrowDown') {
                event.preventDefault();
                setInlineHighlight((i) => (i + 1) % Math.max(inlineResults.length, 1));
                return;
              }
              if (showInlinePanel && event.key === 'ArrowUp') {
                event.preventDefault();
                setInlineHighlight(
                  (i) => (i - 1 + inlineResults.length) % Math.max(inlineResults.length, 1),
                );
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (preferredMention) {
                  onSelectMention(preferredMention, 'inline');
                  return;
                }
                void onSend();
                return;
              }

              if (event.key === 'Backspace' && input.length === 0 && selectedMentions.length > 0) {
                event.preventDefault();
                setSelectedMentions((prev) => prev.slice(0, -1));
                return;
              }

              if (event.key === 'Escape') {
                if (showInlinePanel) {
                  dismissInlinePanel();
                  return;
                }
                setReferencePickerOpen(false);
                setModelMenuOpen(false);
              }
            }}
            disabled={loading}
          />

          <div className="ask-composer-toolbar">
            <div className="ask-composer-actions">
              <button
                ref={referenceBtnRef}
                className={`ask-tool-btn${referencePickerOpen ? ' active' : ''}`}
                onClick={onToggleReferencePicker}
                type="button"
                aria-expanded={referencePickerOpen}
                aria-haspopup="dialog"
              >
                <span className="ask-tool-btn-leading">@</span>
                <span>引用概念</span>
              </button>
              <button
                ref={modelBtnRef}
                className={`ask-tool-btn ask-model-btn${modelMenuOpen ? ' active' : ''}`}
                onClick={() => {
                  setReferencePickerOpen(false);
                  setModelMenuOpen((prev) => !prev);
                }}
                type="button"
                aria-expanded={modelMenuOpen}
                aria-haspopup="dialog"
              >
                <span>模型 · {currentModelLabel}</span>
              </button>
            </div>

            <div className="ask-composer-submit">
              <div className="ask-composer-hint">Enter 发送 / Shift+Enter 换行</div>
              <button
                className="ask-send-btn"
                onClick={() => void onSend()}
                disabled={!input.trim() || loading}
                type="button"
                aria-label="发送问题"
                title="发送问题"
              >
                <Icon.Send />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferencePicker({
  referenceMode,
  setReferenceMode,
  pickerSearch,
  setPickerSearch,
  pickerResults,
  pickerSearchRef,
  onClose,
  onSelect,
}: {
  referenceMode: MentionKind;
  setReferenceMode: Dispatch<SetStateAction<MentionKind>>;
  pickerSearch: string;
  setPickerSearch: Dispatch<SetStateAction<string>>;
  pickerResults: MentionItem[];
  pickerSearchRef: RefObject<HTMLInputElement>;
  onClose: () => void;
  onSelect: (item: MentionItem) => void;
}) {
  return (
    <>
      <div className="ask-flyout-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="ask-flyout ask-reference-flyout" role="dialog" aria-label="添加引用">
        <div className="ask-flyout-header">
          <div className="ask-flyout-title">添加引用</div>
          <div className="ask-segmented">
            <button
              className={`ask-segmented-btn${referenceMode === 'concept' ? ' active' : ''}`}
              onClick={() => setReferenceMode('concept')}
              type="button"
              aria-pressed={referenceMode === 'concept'}
            >
              引用概念
            </button>
            <button
              className={`ask-segmented-btn${referenceMode === 'source' ? ' active' : ''}`}
              onClick={() => setReferenceMode('source')}
              type="button"
              aria-pressed={referenceMode === 'source'}
            >
              引用文件
            </button>
          </div>
        </div>
        <div className="ask-flyout-search">
          <Icon.Search />
          <input
            ref={pickerSearchRef}
            name="ask-reference-search"
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            placeholder={referenceMode === 'concept' ? '搜索概念页…' : '搜索资料或文件…'}
            aria-label={referenceMode === 'concept' ? '搜索概念页' : '搜索资料或文件'}
            autoComplete="off"
          />
        </div>
        <MentionResults
          items={pickerResults}
          emptyLabel={referenceMode === 'concept' ? '没有找到匹配的概念页' : '没有找到匹配的资料'}
          onSelect={onSelect}
        />
      </div>
    </>
  );
}

function ModelSelector({
  modelOptions,
  activeModel,
  onClose,
  onSelectModel,
}: {
  modelOptions: ModelOption[];
  activeModel: string | undefined;
  onClose: () => void;
  onSelectModel: (model: string) => void;
}) {
  // 打开时把焦点移到当前选中项：对话框 portal 在 body 末尾，
  // 不把焦点拉进来的话键盘用户要 Tab 穿越整个页面
  const activeOptionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => activeOptionRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <>
      <div className="ask-flyout-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="ask-flyout ask-model-flyout" role="dialog" aria-label="切换模型">
        <div className="ask-flyout-title">切换模型</div>
        <div className="ask-model-list">
          {modelOptions.map((item) => {
            const active = activeModel === item.value;
            return (
              <button
                key={item.value}
                ref={active ? activeOptionRef : undefined}
                className={`ask-model-option${active ? ' active' : ''}`}
                onClick={() => onSelectModel(item.value)}
                type="button"
                aria-pressed={active}
              >
                <span className="ask-model-option-copy">
                  <span className="ask-model-option-label">{item.label}</span>
                  {item.helper && <span className="ask-model-option-helper">{item.helper}</span>}
                </span>
                <span className="ask-model-option-check">{active ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function MentionResults({
  items,
  emptyLabel,
  highlightIndex,
  onSelect,
}: {
  items: MentionItem[];
  emptyLabel: string;
  highlightIndex?: number;
  onSelect: (item: MentionItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="ask-flyout-empty" role="status">
        {emptyLabel}
      </div>
    );
  }

  const conceptItems = items.filter((item) => item.kind === 'concept');
  const sourceItems = items.filter((item) => item.kind === 'source');
  const keyboardNav = typeof highlightIndex === 'number';
  // 高亮索引按扁平 items 顺序（概念组在前、资料组在后，与 inlineResults 一致）
  const flatIndexOf = (item: MentionItem) =>
    items.findIndex((entry) => entry.id === item.id && entry.kind === item.kind);

  return (
    <div
      className="ask-reference-list"
      id={keyboardNav ? INLINE_LISTBOX_ID : undefined}
      role={keyboardNav ? 'listbox' : undefined}
    >
      {conceptItems.length > 0 && (
        <div className="ask-reference-group">
          <div className="ask-reference-group-label">概念页</div>
          {conceptItems.map((item) => (
            <MentionRow
              key={`${item.kind}-${item.id}`}
              item={item}
              onSelect={onSelect}
              active={keyboardNav && flatIndexOf(item) === highlightIndex}
            />
          ))}
        </div>
      )}

      {sourceItems.length > 0 && (
        <div className="ask-reference-group">
          <div className="ask-reference-group-label">资料文件</div>
          {sourceItems.map((item) => (
            <MentionRow
              key={`${item.kind}-${item.id}`}
              item={item}
              onSelect={onSelect}
              active={keyboardNav && flatIndexOf(item) === highlightIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MentionRow({
  item,
  onSelect,
  active = false,
}: {
  item: MentionItem;
  onSelect: (item: MentionItem) => void;
  active?: boolean;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <button
      ref={rowRef}
      id={`mention-option-${item.kind}-${item.id}`}
      className={`ask-reference-item${active ? ' active' : ''}`}
      onClick={() => onSelect(item)}
      type="button"
      role="option"
      aria-selected={active}
    >
      <span className="ask-reference-item-icon">
        {item.kind === 'concept' ? <Icon.Wiki /> : <SourceTypeIcon type={item.type ?? 'file'} />}
      </span>
      <span className="ask-reference-item-copy">
        <span className="ask-reference-item-title">{item.title}</span>
        <span className="ask-reference-item-subtitle">{item.subtitle}</span>
      </span>
    </button>
  );
}
