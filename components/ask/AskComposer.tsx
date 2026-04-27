'use client';

import { createPortal } from 'react-dom';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { LlmConfig } from '../../lib/types';
import { Icon, SourceTypeIcon } from '../Icons';
import type { MentionItem, MentionKind, ModelOption } from './types';

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
                  title="移除引用"
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
              <div className="ask-inline-tip">输入 `@` 可以直接搜索概念或文件</div>
              <MentionResults
                items={inlineResults}
                emptyLabel="没有找到可引用内容"
                onSelect={(item) => onSelectMention(item, 'inline')}
              />
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="ask-textarea"
            placeholder="问点什么... 输入 @ 引用概念或资料"
            rows={1}
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
              const preferredMention = showInlinePanel ? inlineResults[0] : null;
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
                setReferencePickerOpen(false);
                setModelMenuOpen(false);
              }
            }}
            disabled={loading}
          />

          <div className="ask-composer-toolbar">
            <div className="ask-composer-actions">
              <button
                className={`ask-tool-btn${referencePickerOpen ? ' active' : ''}`}
                onClick={onToggleReferencePicker}
                type="button"
              >
                <span className="ask-tool-btn-leading">@</span>
                <span>引用概念</span>
              </button>
              <button
                className={`ask-tool-btn ask-model-btn${modelMenuOpen ? ' active' : ''}`}
                onClick={() => {
                  setReferencePickerOpen(false);
                  setModelMenuOpen((prev) => !prev);
                }}
                type="button"
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
      <div className="ask-flyout ask-reference-flyout">
        <div className="ask-flyout-header">
          <div className="ask-flyout-title">添加引用</div>
          <div className="ask-segmented">
            <button
              className={`ask-segmented-btn${referenceMode === 'concept' ? ' active' : ''}`}
              onClick={() => setReferenceMode('concept')}
            >
              引用概念
            </button>
            <button
              className={`ask-segmented-btn${referenceMode === 'source' ? ' active' : ''}`}
              onClick={() => setReferenceMode('source')}
            >
              引用文件
            </button>
          </div>
        </div>
        <div className="ask-flyout-search">
          <Icon.Search />
          <input
            ref={pickerSearchRef}
            value={pickerSearch}
            onChange={(event) => setPickerSearch(event.target.value)}
            placeholder={referenceMode === 'concept' ? '搜索概念页...' : '搜索资料或文件...'}
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
  return (
    <>
      <div className="ask-flyout-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="ask-flyout ask-model-flyout">
        <div className="ask-flyout-title">切换模型</div>
        <div className="ask-model-list">
          {modelOptions.map((item) => {
            const active = activeModel === item.value;
            return (
              <button
                key={item.value}
                className={`ask-model-option${active ? ' active' : ''}`}
                onClick={() => onSelectModel(item.value)}
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
  onSelect,
}: {
  items: MentionItem[];
  emptyLabel: string;
  onSelect: (item: MentionItem) => void;
}) {
  if (items.length === 0) {
    return <div className="ask-flyout-empty">{emptyLabel}</div>;
  }

  const conceptItems = items.filter((item) => item.kind === 'concept');
  const sourceItems = items.filter((item) => item.kind === 'source');

  return (
    <div className="ask-reference-list">
      {conceptItems.length > 0 && (
        <div className="ask-reference-group">
          <div className="ask-reference-group-label">概念页</div>
          {conceptItems.map((item) => (
            <MentionRow key={`${item.kind}-${item.id}`} item={item} onSelect={onSelect} />
          ))}
        </div>
      )}

      {sourceItems.length > 0 && (
        <div className="ask-reference-group">
          <div className="ask-reference-group-label">资料文件</div>
          {sourceItems.map((item) => (
            <MentionRow key={`${item.kind}-${item.id}`} item={item} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function MentionRow({
  item,
  onSelect,
}: {
  item: MentionItem;
  onSelect: (item: MentionItem) => void;
}) {
  return (
    <button className="ask-reference-item" onClick={() => onSelect(item)}>
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
