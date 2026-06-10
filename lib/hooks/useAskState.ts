'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { LRUMap } from '@/lib/lru-cache';
import { useAppStore, friendlyErrorMessage } from '@/lib/store';
import { askWikiStream, archiveAnswerAsConcept } from '@/lib/api-client';
import { pickStableConceptTitles } from '@/lib/ask-suggestions';
import {
  createThrottleState,
  appendAndCheckFlush,
  forceFlush,
  resetThrottleState,
  type StreamingThrottleState,
} from '@/lib/streaming-render';
import {
  fetchModelSettings,
  getLlmConfig,
  modelLabel,
  PRESET_MODELS,
  saveLlmConfig,
  saveSelectedModelOnServer,
} from '@/lib/llm-config';
import type { InlineMention, MentionItem, MentionKind, ModelOption } from '@/components/ask/types';
import type {
  AskMessage,
  AskMessageStage,
  AskStageKey,
  Concept,
  LlmConfig,
  Source,
} from '@/lib/types';
import { SOURCE_TYPE_LABELS } from '@/lib/constants';

/** LRU cache for @-mention lookups */
const mentionQueryCache = new LRUMap<string, unknown[]>(50);

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

async function lookupMentions(
  kind: MentionKind,
  rawQuery: string,
  selected: MentionItem[],
  limit = 6,
): Promise<MentionItem[]> {
  const db = getDb();
  const excluded = new Set(selected.filter((item) => item.kind === kind).map((item) => item.id));
  const query = normalizeText(rawQuery);
  const cacheKey = `${kind}:${query}`;

  if (kind === 'concept') {
    let concepts = mentionQueryCache.get(cacheKey) as Concept[] | undefined;
    if (!concepts) {
      concepts = query
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
      mentionQueryCache.set(cacheKey, concepts);
    }

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

  let sources = mentionQueryCache.get(cacheKey) as Source[] | undefined;
  if (!sources) {
    sources = query
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
    mentionQueryCache.set(cacheKey, sources);
  }

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

export function useAskState() {
  const openConcept = useAppStore((s) => s.openConcept);
  const clearAskHistory = useAppStore((s) => s.clearAskHistory);
  const showToast = useAppStore((s) => s.showToast);
  const showErrorToast = useAppStore((s) => s.showErrorToast);

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
  const [streamingText, setStreamingText] = useState('');
  const [liveStages, setLiveStages] = useState<AskMessageStage[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const pickerSearchRef = useRef<HTMLInputElement>(null);
  const throttleRef = useRef<StreamingThrottleState>(createThrottleState());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The fallback flush timer is normally cleared in handleSend's finally
  // block, but unmounting mid-stream (tab switch) would leave it pending.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

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
        const selectedAskModel = settings.selectedAskModel || settings.selectedModel;
        setLlmConfig({
          ...localConfig,
          model: selectedAskModel,
          askModel: selectedAskModel,
          wikiModel: settings.selectedWikiModel,
        });
      })
      .catch(() => {
        setCustomModels([]);
        setHiddenPresetModels([]);
      });
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history?.length, liveStages.length, loading, streamingText]);

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

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const handleSend = useCallback(
    async (overrideText?: string) => {
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
      setStreamingText('');
      setLiveStages([]);
      resetThrottleState(throttleRef.current);

      // Mutable buffer of stages observed during this request. We collect
      // here (instead of relying on `liveStages` state) so we can persist
      // the final list onto the AskMessage without races.
      const stageBuffer: AskMessageStage[] = [];
      function applyStage(event: {
        key: AskStageKey;
        status: 'start' | 'done';
        detail?: string;
        conceptTitles?: string[];
      }) {
        const idx = stageBuffer.findIndex((s) => s.key === event.key);
        const now = Date.now();
        if (idx === -1) {
          stageBuffer.push({
            key: event.key,
            status: event.status === 'done' ? 'done' : 'running',
            detail: event.detail,
            conceptTitles: event.conceptTitles,
            startedAt: now,
            durationMs: event.status === 'done' ? 0 : undefined,
          });
        } else {
          const prev = stageBuffer[idx];
          stageBuffer[idx] = {
            ...prev,
            status: event.status === 'done' ? 'done' : prev.status,
            detail: event.detail ?? prev.detail,
            conceptTitles: event.conceptTitles ?? prev.conceptTitles,
            durationMs:
              event.status === 'done' && prev.startedAt ? now - prev.startedAt : prev.durationMs,
          };
        }
        setLiveStages([...stageBuffer]);
      }

      /** Flush the accumulated throttle text to React state for rendering. */
      function flushStreamingText() {
        setStreamingText(throttleRef.current.text);
      }

      try {
        const resp = await askWikiStream(
          finalText,
          [...recentHistory, { role: 'user', text: finalText }],
          (delta) => {
            // Throttled accumulation: only flush to React state when the
            // throttle policy says so, instead of every single token.
            const shouldFlush = appendAndCheckFlush(throttleRef.current, delta, Date.now());
            if (shouldFlush) {
              flushStreamingText();
            } else if (!flushTimerRef.current) {
              // Schedule a fallback flush so text doesn't stay stale for
              // too long when deltas arrive just under the interval threshold.
              flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                flushStreamingText();
              }, 60);
            }
          },
          { onStage: applyStage },
        );

        // Final flush: ensure all remaining buffered text is rendered
        // with full quality (complete markdown parse of the entire text).
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushStreamingText();

        const aiMsg: AskMessage = {
          id: 'm-' + nanoid(8),
          role: 'ai',
          text: resp.answer,
          citedConcepts: resp.citedConceptIds,
          faithfulness: resp.faithfulness,
          suggestedTitle: resp.archivable ? resp.suggestedTitle : undefined,
          suggestedSummary: resp.archivable ? resp.suggestedSummary : undefined,
          suggestedQuestions: resp.suggestedQuestions?.length ? resp.suggestedQuestions : undefined,
          stages: stageBuffer.length > 0 ? stageBuffer : undefined,
          at: Date.now(),
        };
        await db.askHistory.put(aiMsg);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const friendly = friendlyErrorMessage(raw);
        // Store structured error: friendly message for display, raw detail in hidden block
        const rawEncoded = raw.slice(0, 300).replace(/-->/g, '— >');
        await db.askHistory.put({
          id: 'm-' + nanoid(8),
          role: 'ai',
          text: `**问答失败**: ${friendly}\n\n请检查 API 配置，或确认 Wiki 中已有内容可供查询。\n\n<!-- error-detail:${rawEncoded} -->`,
          at: Date.now(),
        });
      } finally {
        setLoading(false);
        setStreamingText('');
        setLiveStages([]);
        resetThrottleState(throttleRef.current);
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [input, loading, selectedMentions, history, autoResize],
  );

  const handleArchive = useCallback(
    async (msg: AskMessage, userQuestion: string | null) => {
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
        showErrorToast('归档失败', () => handleArchive(msg, userQuestion));
      } finally {
        setArchiving(null);
      }
    },
    [showErrorToast],
  );

  const updateInput = useCallback(
    (next: string, nextCaret?: number) => {
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
    },
    [autoResize],
  );

  const handleSelectMention = useCallback(
    (item: MentionItem, source: 'picker' | 'inline') => {
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
    },
    [inlineMention, input, updateInput],
  );

  const removeMention = useCallback((target: MentionItem) => {
    setSelectedMentions((prev) =>
      prev.filter((item) => !(item.id === target.id && item.kind === target.kind)),
    );
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const toggleReferencePicker = useCallback(() => {
    setModelMenuOpen(false);
    setReferencePickerOpen((prev) => !prev);
    setReferenceMode('concept');
    setPickerSearch('');
  }, []);

  const selectModel = useCallback(
    (model: string) => {
      const nextConfig = {
        ...llmConfig,
        model: model || undefined,
        askModel: model || undefined,
      };
      saveLlmConfig(nextConfig);
      setLlmConfig(nextConfig);
      void saveSelectedModelOnServer(model).then((settings) => {
        setCustomModels(settings.models);
        setHiddenPresetModels(settings.hiddenPresetModels);
      });
      setModelMenuOpen(false);
    },
    [llmConfig],
  );

  const restartConversation = useCallback(async () => {
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
  }, [loading, clearAskHistory, showToast]);

  return {
    // State
    input,
    setInput,
    loading,
    archiving,
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
    streamingText,
    liveStages,
    history,
    conceptCount,
    suggestions,

    // Refs
    textareaRef,
    composerRef,
    pickerSearchRef,
    messagesRef,

    // Actions
    autoResize,
    setCaretPosition,
    handleSend,
    handleArchive,
    handleSelectMention,
    removeMention,
    toggleReferencePicker,
    selectModel,
    restartConversation,
    openConcept,
  };
}
