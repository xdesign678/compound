'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { askWiki, archiveAnswerAsConcept } from '@/lib/api-client';
import { fetchCustomModels, getLlmConfig, modelLabel, PRESET_MODELS, saveLlmConfig } from '@/lib/llm-config';
import { Icon, SourceTypeIcon } from '../Icons';
import { Prose } from '../Prose';
import type { AskMessage, LlmConfig, Source, SourceType } from '@/lib/types';

type MentionKind = 'concept' | 'source';

type MentionItem = {
  id: string;
  kind: MentionKind;
  title: string;
  subtitle: string;
  type?: SourceType;
};

type InlineMention = {
  start: number;
  end: number;
  query: string;
};

type ModelOption = {
  label: string;
  value: string;
  helper?: string;
};

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  link: '链接',
  text: '文本',
  file: '文件',
  article: '文章',
  book: '书籍',
  pdf: 'PDF',
  gist: '代码片段',
};

export function AskView() {
  const openConcept = useAppStore((s) => s.openConcept);
  const clearAskHistory = useAppStore((s) => s.clearAskHistory);
  const showToast = useAppStore((s) => s.showToast);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState<MentionItem[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceMode, setReferenceMode] = useState<MentionKind>('concept');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerResults, setPickerResults] = useState<MentionItem[]>([]);
  const [inlineResults, setInlineResults] = useState<MentionItem[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [caretPosition, setCaretPosition] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const pickerSearchRef = useRef<HTMLInputElement>(null);

  const history = useLiveQuery(
    async () => getDb().askHistory.orderBy('at').toArray(),
    []
  );

  const conceptCount = useLiveQuery(async () => getDb().concepts.count(), []);

  useEffect(() => {
    setLlmConfig(getLlmConfig());
    void fetchCustomModels().then(setCustomModels).catch(() => setCustomModels([]));
  }, []);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [history?.length, loading]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!composerRef.current?.contains(event.target as Node)) {
        setReferencePickerOpen(false);
        setModelMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setReferencePickerOpen(false);
        setModelMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!referencePickerOpen) return;
    const id = window.setTimeout(() => pickerSearchRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [referencePickerOpen, referenceMode]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  const inlineMention = useMemo(
    () => detectInlineMention(input, caretPosition),
    [input, caretPosition]
  );

  const modelOptions = useMemo<ModelOption[]>(() => {
    const customModel = llmConfig.model?.trim();
    const options: ModelOption[] = [{
      label: '服务端默认',
      value: '',
      helper: '跟随当前服务端配置',
    }, ...PRESET_MODELS.map((item) => ({
      label: item.label,
      value: item.value,
      helper: item.value,
    })), ...customModels.map((model) => ({
      label: modelLabel(model),
      value: model,
      helper: model,
    }))];

    if (customModel && !options.some((item) => item.value === customModel)) {
      options.splice(1, 0, {
        label: `当前配置 · ${compactModelName(customModel)}`,
        value: customModel,
        helper: customModel,
      });
    }

    return options;
  }, [customModels, llmConfig.model]);

  const currentModelLabel = useMemo(() => {
    const current = llmConfig.model?.trim();
    if (!current) return '服务端默认';
    return modelOptions.find((item) => item.value === current)?.label ?? compactModelName(current);
  }, [llmConfig.model, modelOptions]);

  const showInlinePanel = !!inlineMention && !referencePickerOpen && !modelMenuOpen;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!referencePickerOpen) {
        setPickerResults([]);
        return;
      }
      const result = await lookupMentions(referenceMode, pickerSearch, selectedMentions);
      if (!cancelled) setPickerResults(result);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [pickerSearch, referenceMode, referencePickerOpen, selectedMentions]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!inlineMention) {
        setInlineResults([]);
        return;
      }
      const [concepts, sources] = await Promise.all([
        lookupMentions('concept', inlineMention.query, selectedMentions, 4),
        lookupMentions('source', inlineMention.query, selectedMentions, 4),
      ]);
      if (!cancelled) {
        setInlineResults([...concepts, ...sources]);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [inlineMention, selectedMentions]);

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    const finalText = buildAskText(selectedMentions, text);
    if (!text || loading || !finalText) return;

    const recentHistory = (history || [])
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    const db = getDb();
    const now = Date.now();
    const userMsg: AskMessage = {
      id: 'm-' + nanoid(8),
      role: 'user',
      text: finalText,
      at: now,
    };
    await db.askHistory.put(userMsg);
    setInput('');
    setSelectedMentions([]);
    setPickerSearch('');
    setReferencePickerOpen(false);
    setModelMenuOpen(false);
    autoResize();
    setLoading(true);

    try {
      const resp = await askWiki(finalText, [...recentHistory, { role: 'user', text: finalText }]);

      const aiMsg: AskMessage = {
        id: 'm-' + nanoid(8),
        role: 'ai',
        text: resp.answer,
        citedConcepts: resp.citedConceptIds,
        suggestedTitle: resp.archivable ? resp.suggestedTitle : undefined,
        suggestedSummary: resp.archivable ? resp.suggestedSummary : undefined,
        at: Date.now(),
      };
      await db.askHistory.put(aiMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.askHistory.put({
        id: 'm-' + nanoid(8),
        role: 'ai',
        text: `**问答失败**: ${msg.slice(0, 160)}\n\n请检查 API 配置,或确认 Wiki 中已有内容可供查询。`,
        at: Date.now(),
      });
    } finally {
      setLoading(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  async function handleArchive(msg: AskMessage, userQuestion: string | null) {
    if (!msg.citedConcepts || msg.citedConcepts.length === 0) return;
    setArchiving(msg.id);
    const title = userQuestion ? (userQuestion.length > 20 ? userQuestion.slice(0, 20) + '…' : userQuestion) : '新归档概念';
    const summary = msg.text.replace(/<[^>]+>/g, '').replace(/\*\*/g, '').slice(0, 80) + (msg.text.length > 80 ? '…' : '');
    try {
      const newId = await archiveAnswerAsConcept(title, summary, msg.text, msg.citedConcepts);
      const db = getDb();
      await db.askHistory.update(msg.id, { savedAsConceptId: newId });
    } catch (err) {
      console.error(err);
      showToast('归档失败，请重试', false, true);
    } finally {
      setArchiving(null);
    }
  }

  function updateInput(next: string, nextCaret?: number) {
    setInput(next);
    const caret = typeof nextCaret === 'number' ? nextCaret : next.length;
    setCaretPosition(caret);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = caret;
        textareaRef.current.selectionEnd = caret;
      }
      autoResize();
    });
  }

  function handleSelectMention(item: MentionItem, source: 'picker' | 'inline') {
    setSelectedMentions((prev) => {
      if (prev.some((existing) => existing.id === item.id && existing.kind === item.kind)) return prev;
      return [...prev, item];
    });

    if (source === 'inline' && inlineMention) {
      const nextInput = `${input.slice(0, inlineMention.start)}${input.slice(inlineMention.end)}`.replace(/\s{2,}/g, ' ');
      updateInput(nextInput, inlineMention.start);
    }

    setPickerSearch('');
    setReferencePickerOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function removeMention(target: MentionItem) {
    setSelectedMentions((prev) => prev.filter((item) => !(item.id === target.id && item.kind === target.kind)));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function toggleReferencePicker() {
    setModelMenuOpen(false);
    setReferencePickerOpen((prev) => !prev);
    setReferenceMode('concept');
    setPickerSearch('');
  }

  function selectModel(model: string) {
    const nextConfig = { ...llmConfig, model: model || undefined };
    saveLlmConfig(nextConfig);
    setLlmConfig(nextConfig);
    setModelMenuOpen(false);
  }

  const [conceptTitles, setConceptTitles] = useState<string[]>([]);
  useEffect(() => {
    getDb()
      .concepts
      .orderBy('updatedAt')
      .reverse()
      .limit(50)
      .toArray()
      .then((concepts) => {
        const shuffled = concepts.sort(() => Math.random() - 0.5);
        setConceptTitles(shuffled.slice(0, 3).map((c) => c.title));
      });
  }, []);

  const suggestions = useMemo(() => {
    if ((conceptCount ?? 0) === 0) return [];
    if (conceptTitles.length > 0) {
      return conceptTitles.map((title) => `${title}是什么？`);
    }
    return ['这个知识库里有什么内容？', '最近添加了哪些资料？', '请总结一下主要概念'];
  }, [conceptCount, conceptTitles]);

  const lastAnswerFailed = useMemo(() => {
    const lastAnswer = [...(history ?? [])].reverse().find((m) => m.role === 'ai');
    return lastAnswer ? isAskFailureMessage(lastAnswer.text) : false;
  }, [history]);

  return (
    <div className="ask-view">
      {history && history.length > 0 && (
        <div className="ask-toolbar">
          <div className="ask-toolbar-inner">
            {confirmClear ? (
              <>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginRight: 8 }}>确认清空所有对话？</span>
                <button
                  className="ask-reset-btn"
                  onClick={() => { clearAskHistory(); setConfirmClear(false); }}
                  style={{ background: 'var(--brand-clay)', color: '#fff', marginRight: 4 }}
                >
                  清空
                </button>
                <button
                  className="ask-reset-btn"
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                className="ask-reset-btn"
                onClick={() => setConfirmClear(true)}
              >
                新对话
              </button>
            )}
          </div>
        </div>
      )}
      <div className="ask-messages" ref={messagesRef}>
        <div className="ask-stream">
          {history && history.length === 0 && !loading ? (
            <div className="ask-empty">
              <div className="ask-empty-kicker">知识提问</div>
              <div className="big-icon">
                <Icon.Sparkle />
              </div>
              <h3>从你的 Wiki 问起</h3>
              <p>
                答案从已综合的概念页中提取,带引用。好的回答可以归档为新页面。
                {(conceptCount ?? 0) === 0 && <><br /><br /><strong>Wiki 当前为空</strong>,请先添加一些资料。</>}
              </p>
              {suggestions.length > 0 && (
                <div className="suggested-questions">
                  {suggestions.map((s) => (
                    <button key={s} className="suggested-q" onClick={() => handleSend(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {lastAnswerFailed && (
                <div className="ask-recovery-banner">
                  <div>
                    <div className="ask-recovery-title">上一次问答没有完成</div>
                    <div className="ask-recovery-copy">通常是 API 配置或服务端暂时不可用。可以重新开始，也可以保留记录继续问。</div>
                  </div>
                  <button
                    className="ask-reset-btn ask-recovery-action"
                    onClick={() => { clearAskHistory(); setConfirmClear(false); }}
                  >
                    重新开始
                  </button>
                </div>
              )}
              {history?.map((m, idx) => {
                if (m.role === 'user') {
                  return (
                    <div key={m.id} className="msg msg-user-row">
                      <div className="msg-user">{m.text}</div>
                    </div>
                  );
                }
                const prev = history[idx - 1];
                const userQ = prev?.role === 'user' ? prev.text : null;
                const failedAnswer = isAskFailureMessage(m.text);
                return (
                  <div key={m.id} className="msg msg-ai-row">
                    <div className={`msg-ai-card${failedAnswer ? ' ask-failure-card' : ''}`}>
                      <div className="msg-ai-label">Wiki 答案</div>
                      {failedAnswer ? (
                        <div className="ask-failure-copy">
                          <div className="ask-failure-title">问答暂时没成功</div>
                          <p>通常是模型 API 或服务端配置暂时不可用。你可以检查设置里的模型配置，或者稍后重新提问。</p>
                        </div>
                      ) : (
                        <Prose markdown={m.text} citedConceptIds={m.citedConcepts} className="prose-answer" />
                      )}
                      {!failedAnswer && m.citedConcepts && m.citedConcepts.length > 0 && (
                        <div className="msg-sources">
                          <div className="ms-label">基于概念页</div>
                          <CitedList ids={m.citedConcepts} onClick={openConcept} />
                        </div>
                      )}
                      {!failedAnswer && m.citedConcepts && m.citedConcepts.length > 0 && (
                        m.savedAsConceptId ? (
                          <button className="save-as-page" disabled>
                            <Icon.Save />
                            已归档为 Wiki 页面
                          </button>
                        ) : (
                          <button
                            className="save-as-page"
                            disabled={archiving === m.id}
                            onClick={() => handleArchive(m, userQ)}
                          >
                            <Icon.Save />
                            {archiving === m.id ? '归档中...' : '归档为新页面'}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
              {loading && (
                <div className="msg msg-ai-row">
                  <div className="msg-ai-card loading">
                    <div className="msg-ai-label loading">Wiki 思考中</div>
                    <div className="msg-ai-body">正在从 {conceptCount} 个概念页中综合...</div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
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
                    onClick={() => removeMention(item)}
                    title="移除引用"
                  >
                    <span className="ask-mention-chip-kind">{item.kind === 'concept' ? '@概念' : '@文件'}</span>
                    <span className="ask-mention-chip-title">{item.title}</span>
                    <span className="ask-mention-chip-close">×</span>
                  </button>
                ))}
              </div>
            )}

            {referencePickerOpen && (
              <>
                <div
                  className="ask-flyout-backdrop"
                  onClick={() => setReferencePickerOpen(false)}
                  aria-hidden="true"
                />
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
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder={referenceMode === 'concept' ? '搜索概念页...' : '搜索资料或文件...'}
                    />
                  </div>
                  <MentionResults
                    items={pickerResults}
                    emptyLabel={referenceMode === 'concept' ? '没有找到匹配的概念页' : '没有找到匹配的资料'}
                    onSelect={(item) => handleSelectMention(item, 'picker')}
                  />
                </div>
              </>
            )}

            {modelMenuOpen && (
              <>
                <div
                  className="ask-flyout-backdrop"
                  onClick={() => setModelMenuOpen(false)}
                  aria-hidden="true"
                />
                <div className="ask-flyout ask-model-flyout">
                  <div className="ask-flyout-title">切换模型</div>
                  <div className="ask-model-list">
                    {modelOptions.map((item) => {
                      const active = llmConfig.model === item.value;
                      return (
                        <button
                          key={item.value}
                          className={`ask-model-option${active ? ' active' : ''}`}
                          onClick={() => selectModel(item.value)}
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
            )}

            {showInlinePanel && (
              <div className="ask-flyout ask-inline-flyout">
                <div className="ask-inline-tip">输入 `@` 可以直接搜索概念或文件</div>
                <MentionResults
                  items={inlineResults}
                  emptyLabel="没有找到可引用内容"
                  onSelect={(item) => handleSelectMention(item, 'inline')}
                />
              </div>
            )}

            <textarea
              ref={textareaRef}
              className="ask-textarea"
              placeholder="问点什么... 输入 @ 引用概念或资料"
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCaretPosition(e.target.selectionStart);
                autoResize();
              }}
              onClick={(e) => setCaretPosition((e.target as HTMLTextAreaElement).selectionStart)}
              onKeyUp={(e) => setCaretPosition((e.target as HTMLTextAreaElement).selectionStart)}
              onSelect={(e) => setCaretPosition((e.target as HTMLTextAreaElement).selectionStart)}
              onKeyDown={(e) => {
                const preferredMention = showInlinePanel ? inlineResults[0] : null;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (preferredMention) {
                    handleSelectMention(preferredMention, 'inline');
                    return;
                  }
                  handleSend();
                  return;
                }

                if (e.key === 'Backspace' && input.length === 0 && selectedMentions.length > 0) {
                  e.preventDefault();
                  setSelectedMentions((prev) => prev.slice(0, -1));
                  return;
                }

                if (e.key === 'Escape') {
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
                  onClick={toggleReferencePicker}
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
                  onClick={() => handleSend()}
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
    </div>
  );
}

function isAskFailureMessage(text: string) {
  const normalized = text.trim();
  return normalized.includes('问答失败') || normalized.includes('/api/query failed');
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

function CitedList({ ids, onClick }: { ids: string[]; onClick: (id: string) => void }) {
  const concepts = useLiveQuery(async () => {
    const db = getDb();
    const items = await Promise.all(ids.map((id) => db.concepts.get(id)));
    return items.filter(Boolean);
  }, [ids.join(',')]);

  if (!concepts) return null;
  return (
    <>
      {concepts.map((c) => (
        <button key={c!.id} className="ms-item" onClick={() => onClick(c!.id)}>
          {c!.title}
        </button>
      ))}
    </>
  );
}

async function lookupMentions(
  kind: MentionKind,
  rawQuery: string,
  selected: MentionItem[],
  limit = 6
): Promise<MentionItem[]> {
  const db = getDb();
  const excluded = new Set(selected.filter((item) => item.kind === kind).map((item) => item.id));
  const query = normalizeText(rawQuery);

  if (kind === 'concept') {
    let concepts = query
      ? await db.concepts
          .toCollection()
          .filter((concept) => matchesText([concept.title, concept.summary], query))
          .limit(limit * 3)
          .toArray()
      : await db.concepts.orderBy('updatedAt').reverse().limit(limit * 2).toArray();

    concepts = concepts
      .filter((concept) => !excluded.has(concept.id))
      .sort((a, b) => scoreMatch([b.title, b.summary], query) - scoreMatch([a.title, a.summary], query))
      .slice(0, limit);

    return concepts.map((concept) => ({
      id: concept.id,
      kind: 'concept',
      title: concept.title,
      subtitle: concept.summary || '概念页',
    }));
  }

  let sources = query
    ? await db.sources
        .toCollection()
        .filter((source) => matchesText([source.title, source.author, source.url], query))
        .limit(limit * 3)
        .toArray()
    : await db.sources.orderBy('ingestedAt').reverse().limit(limit * 2).toArray();

  sources = sources
    .filter((source) => !excluded.has(source.id))
    .sort((a, b) => scoreMatch([b.title, b.author, b.url], query) - scoreMatch([a.title, a.author, a.url], query))
    .slice(0, limit);

  return sources.map((source) => ({
    id: source.id,
    kind: 'source',
    title: source.title,
    subtitle: describeSource(source),
    type: source.type,
  }));
}

function detectInlineMention(text: string, caret: number): InlineMention | null {
  const beforeCaret = text.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const query = match[1] ?? '';
  return {
    start: caret - query.length - 1,
    end: caret,
    query,
  };
}

function buildAskText(mentions: MentionItem[], text: string): string {
  const mentionText = mentions.map((item) => `@${item.title}`).join(' ');
  return [mentionText, text].filter(Boolean).join('\n').trim();
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function matchesText(parts: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  return parts.some((part) => normalizeText(part).includes(query));
}

function scoreMatch(parts: Array<string | undefined>, query: string): number {
  if (!query) return 0;
  const haystack = parts.map((part) => normalizeText(part)).join(' ');
  if (haystack.startsWith(query)) return 5;
  if (haystack.includes(query)) return 3;
  return 0;
}

function compactModelName(model: string): string {
  const preset = PRESET_MODELS.find((item) => item.value === model);
  if (preset) return preset.label;
  const last = model.split('/').pop() || model;
  return last.replace(/-/g, ' ');
}

function describeSource(source: Source): string {
  const base = SOURCE_TYPE_LABELS[source.type] || '资料';
  if (source.author) return `${base} · ${source.author}`;
  if (source.url) return `${base} · ${stripProtocol(source.url)}`;
  return `${base} · 已收录资料`;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
