'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { nanoid } from 'nanoid';
import { getDb } from '@/lib/db';
import { useAppStore } from '@/lib/store';
import { askWiki, archiveAnswerAsConcept } from '@/lib/api-client';
import { Icon } from '../Icons';
import { Prose } from '../Prose';
import type { AskMessage } from '@/lib/types';

export function AskView() {
  const openConcept = useAppStore((s) => s.openConcept);
  const clearAskHistory = useAppStore((s) => s.clearAskHistory);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const history = useLiveQuery(
    async () => getDb().askHistory.orderBy('at').toArray(),
    []
  );

  const conceptCount = useLiveQuery(async () => getDb().concepts.count(), []);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [history?.length, loading]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  }

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    // Capture history snapshot before writing the new user message to avoid double-counting
    const recentHistory = (history || [])
      .slice(-6)
      .map((m) => ({ role: m.role, text: m.text }));

    const db = getDb();
    const now = Date.now();
    const userMsg: AskMessage = {
      id: 'm-' + nanoid(8),
      role: 'user',
      text,
      at: now,
    };
    await db.askHistory.put(userMsg);
    setInput('');
    autoResize();
    setLoading(true);

    try {
      const resp = await askWiki(text, [...recentHistory, { role: 'user', text }]);

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
      alert('归档失败，请重试');
    } finally {
      setArchiving(null);
    }
  }

  const [conceptTitles, setConceptTitles] = useState<string[]>([]);
  useEffect(() => {
    getDb().concepts.toArray().then((concepts) => {
      const shuffled = concepts.sort(() => Math.random() - 0.5);
      setConceptTitles(shuffled.slice(0, 3).map(c => c.title));
    });
  }, []);

  const suggestions = useMemo(() => {
    if ((conceptCount ?? 0) === 0) return [];
    if (conceptTitles && conceptTitles.length > 0) {
      return conceptTitles.map(t => `${t}是什么？`);
    }
    return ['这个知识库里有什么内容？', '最近添加了哪些资料？', '请总结一下主要概念'];
  }, [conceptCount, conceptTitles]);

  return (
    <div className="ask-view">
      {history && history.length > 0 && (
        <div className="ask-toolbar">
          <button
            className="ask-reset-btn"
            onClick={() => { if (window.confirm('确认清空所有对话记录？')) clearAskHistory(); }}
          >
            新对话
          </button>
        </div>
      )}
      <div className="ask-messages" ref={messagesRef}>
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
              return (
                <div key={m.id} className="msg msg-ai-row">
                  <div className="msg-ai-card">
                    <div className="msg-ai-label">Wiki 答案</div>
                    <Prose markdown={m.text} citedConceptIds={m.citedConcepts} className="prose-answer" />
                    {m.citedConcepts && m.citedConcepts.length > 0 && (
                      <div className="msg-sources">
                        <div className="ms-label">基于概念页</div>
                        <CitedList ids={m.citedConcepts} onClick={openConcept} />
                      </div>
                    )}
                    {m.citedConcepts && m.citedConcepts.length > 0 && (
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
      <div className="ask-input-bar">
        <textarea
          ref={textareaRef}
          className="ask-textarea"
          placeholder="问点什么..."
          rows={1}
          value={input}
          onChange={(e) => { setInput(e.target.value); autoResize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={loading}
        />
        <button className="ask-send-btn" onClick={() => handleSend()} disabled={!input.trim() || loading}>
          <Icon.Send />
        </button>
      </div>
    </div>
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
