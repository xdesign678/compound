'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { nanoid } from 'nanoid';
import { getDb } from '../../lib/db';
import { useAppStore } from '../../lib/store';
import { askWiki, archiveAnswerAsConcept } from '../../lib/api-client';
import { pickStableConceptTitles } from '../../lib/ask-suggestions';
import {
  fetchModelSettings,
  getLlmConfig,
  modelLabel,
  PRESET_MODELS,
  saveLlmConfig,
  saveSelectedModelOnServer,
} from '../../lib/llm-config';
import { AskComposer } from '../ask/AskComposer';
import { AskMessageList } from '../ask/AskMessageList';
import { Icon } from '../Icons';
import type { InlineMention, MentionItem, MentionKind, ModelOption } from '../ask/types';
import type { AskMessage, LlmConfig, Source, SourceType } from '../../lib/types';

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
  const [selectedMentions, setSelectedMentions] = useState<MentionItem[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceMode, setReferenceMode] = useState<MentionKind>('concept');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerResults, setPickerResults] = useState<MentionItem[]>([]);
  const [inlineResults, setInlineResults] = useState<MentionItem[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>({});
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [hiddenPresetModels, setHiddenPresetModels] = useState<string[]>([]);
  const [caretPosition, setCaretPosition] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [conceptTitles, setConceptTitles] = useState<string[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const pickerSearchRef = useRef<HTMLInputElement>(null);

  const history = useLiveQuery(async () => getDb().askHistory.orderBy('at').toArray(), []);
  const conceptCount = useLiveQuery(async () => getDb().concepts.count(), []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const localConfig = getLlmConfig();
    setLlmConfig(localConfig);
    void fetchModelSettings()
      .then((settings) => {
        setCustomModels(settings.models);
        setHiddenPresetModels(settings.hiddenPresetModels);
        setLlmConfig({ ...localConfig, model: settings.selectedModel });
      })
      .catch(() => {
        setCustomModels([]);
        setHiddenPresetModels([]);
      });
  }, []);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [history?.length, loading]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (composerRef.current?.contains(target)) return;
      const el = target as HTMLElement;
      if (el && typeof el.closest === 'function' && el.closest('.ask-flyout')) return;
      setReferencePickerOpen(false);
      setModelMenuOpen(false);
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

  const inlineMention = useMemo(
    () => detectInlineMention(input, caretPosition),
    [input, caretPosition],
  );

  const modelOptions = useMemo<ModelOption[]>(() => {
    const customModel = llmConfig.model?.trim();
    const options: ModelOption[] = [
      {
        label: '服务端默认',
        value: '',
        helper: '跟随当前服务端配置',
      },
      ...PRESET_MODELS.filter((item) => !hiddenPresetModels.includes(item.value)).map((item) => ({
        label: item.label,
        value: item.value,
        helper: item.value,
      })),
      ...customModels.map((model) => ({
        label: modelLabel(model),
        value: model,
        helper: model,
      })),
    ];

    if (customModel && !options.some((item) => item.value === customModel)) {
      options.splice(1, 0, {
        label: `当前配置 · ${compactModelName(customModel)}`,
        value: customModel,
        helper: customModel,
      });
    }

    return options;
  }, [customModels, hiddenPresetModels, llmConfig.model]);

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

  useEffect(() => {
    getDb()
      .concepts.orderBy('updatedAt')
      .reverse()
      .limit(50)
      .toArray()
      .then((concepts) => {
        setConceptTitles(pickStableConceptTitles(concepts));
      });
  }, []);

  const suggestions = useMemo(() => {
    if ((conceptCount ?? 0) === 0) return [];
    if (conceptTitles.length > 0) {
      return conceptTitles.map((title) => `${title}是什么？`);
    }
    return ['这个知识库里有什么内容？', '最近添加了哪些资料？', '请总结一下主要概念'];
  }, [conceptCount, conceptTitles]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    const finalText = buildAskText(selectedMentions, text);
    if (!text || loading || !finalText) return;

    const recentHistory = (history || []).slice(-6).map((m) => ({ role: m.role, text: m.text }));

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
    const title = userQuestion
      ? userQuestion.length > 20
        ? userQuestion.slice(0, 20) + '…'
        : userQuestion
      : '新归档概念';
    const summary =
      msg.text
        .replace(/<[^>]+>/g, '')
        .replace(/\*\*/g, '')
        .slice(0, 80) + (msg.text.length > 80 ? '…' : '');
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
      if (prev.some((existing) => existing.id === item.id && existing.kind === item.kind))
        return prev;
      return [...prev, item];
    });

    if (source === 'inline' && inlineMention) {
      const nextInput =
        `${input.slice(0, inlineMention.start)}${input.slice(inlineMention.end)}`.replace(
          /\s{2,}/g,
          ' ',
        );
      updateInput(nextInput, inlineMention.start);
    }

    setPickerSearch('');
    setReferencePickerOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function removeMention(target: MentionItem) {
    setSelectedMentions((prev) =>
      prev.filter((item) => !(item.id === target.id && item.kind === target.kind)),
    );
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
    void saveSelectedModelOnServer(model).then((settings) => {
      setCustomModels(settings.models);
      setHiddenPresetModels(settings.hiddenPresetModels);
    });
    setModelMenuOpen(false);
  }

  async function restartConversation() {
    if (loading) return;
    setInput('');
    setSelectedMentions([]);
    setPickerSearch('');
    setReferencePickerOpen(false);
    setModelMenuOpen(false);
    setInlineResults([]);
    await clearAskHistory();
    showToast('已开始新对话');
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="ask-view">
      {history && history.length > 0 && (
        <div className="ask-toolbar">
          <div className="ask-toolbar-inner">
            <button
              className="ask-reset-btn ask-new-chat-btn"
              type="button"
              onClick={() => void restartConversation()}
              disabled={loading}
              aria-label="开始新对话"
            >
              <Icon.Plus />
              <span>新对话</span>
            </button>
          </div>
        </div>
      )}

      <AskMessageList
        history={history}
        loading={loading}
        conceptCount={conceptCount}
        suggestions={suggestions}
        archiving={archiving}
        messagesRef={messagesRef}
        onSendSuggestion={handleSend}
        onRestart={restartConversation}
        onArchive={handleArchive}
        onOpenConcept={openConcept}
      />

      <AskComposer
        input={input}
        setInput={setInput}
        loading={loading}
        selectedMentions={selectedMentions}
        setSelectedMentions={setSelectedMentions}
        referencePickerOpen={referencePickerOpen}
        setReferencePickerOpen={setReferencePickerOpen}
        referenceMode={referenceMode}
        setReferenceMode={setReferenceMode}
        pickerSearch={pickerSearch}
        setPickerSearch={setPickerSearch}
        pickerResults={pickerResults}
        inlineResults={inlineResults}
        modelMenuOpen={modelMenuOpen}
        setModelMenuOpen={setModelMenuOpen}
        llmConfig={llmConfig}
        mounted={mounted}
        showInlinePanel={showInlinePanel}
        currentModelLabel={currentModelLabel}
        modelOptions={modelOptions}
        textareaRef={textareaRef}
        composerRef={composerRef}
        pickerSearchRef={pickerSearchRef}
        autoResize={autoResize}
        setCaretPosition={setCaretPosition}
        onSelectMention={handleSelectMention}
        onRemoveMention={removeMention}
        onToggleReferencePicker={toggleReferencePicker}
        onSelectModel={selectModel}
        onSend={handleSend}
      />
    </div>
  );
}

async function lookupMentions(
  kind: MentionKind,
  rawQuery: string,
  selected: MentionItem[],
  limit = 6,
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
      : await db.concepts
          .orderBy('updatedAt')
          .reverse()
          .limit(limit * 2)
          .toArray();

    concepts = concepts
      .filter((concept) => !excluded.has(concept.id))
      .sort(
        (a, b) => scoreMatch([b.title, b.summary], query) - scoreMatch([a.title, a.summary], query),
      )
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
    : await db.sources
        .orderBy('ingestedAt')
        .reverse()
        .limit(limit * 2)
        .toArray();

  sources = sources
    .filter((source) => !excluded.has(source.id))
    .sort(
      (a, b) =>
        scoreMatch([b.title, b.author, b.url], query) -
        scoreMatch([a.title, a.author, a.url], query),
    )
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
