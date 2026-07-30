'use client';

import type { RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../lib/db';
import { formatConceptBodyForDisplay } from '../../lib/concept-body-format';
import type { AskMessage, AskMessageStage } from '../../lib/types';
import { Icon } from '../Icons';
import { Prose } from '../Prose';
import { AskEmptyState } from './AskEmptyState';
import { ThinkingPanel, ThinkingTrace } from './ThinkingPanel';

export function AskMessageList({
  history,
  loading,
  streamingText,
  liveStages,
  conceptCount,
  suggestions,
  archiving,
  messagesRef,
  onSendSuggestion,
  onRestart,
  onArchive,
  onOpenConcept,
}: {
  history: AskMessage[] | undefined;
  loading: boolean;
  streamingText: string;
  liveStages: AskMessageStage[];
  conceptCount: number | undefined;
  suggestions: string[];
  archiving: string | null;
  messagesRef: RefObject<HTMLDivElement>;
  onSendSuggestion: (text: string) => void | Promise<void>;
  onRestart: () => void | Promise<void>;
  onArchive: (message: AskMessage, userQuestion: string | null) => void | Promise<void>;
  onOpenConcept: (id: string) => void;
}) {
  const lastAnswerFailed = (() => {
    const lastAnswer = [...(history ?? [])].reverse().find((message) => message.role === 'ai');
    return lastAnswer ? isAskFailureMessage(lastAnswer.text) : false;
  })();

  // Find the last user question (for retry functionality)
  const lastUserQuestion = (() => {
    const msgs = history ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') return msgs[i].text;
    }
    return null;
  })();

  return (
    <div className="ask-messages" ref={messagesRef}>
      <div className="ask-stream">
        {history === undefined ? (
          <div className="ask-history-loading" role="status" aria-live="polite">
            加载对话记录…
          </div>
        ) : history.length === 0 && !loading ? (
          <AskEmptyState
            conceptCount={conceptCount ?? 0}
            suggestions={suggestions}
            onSend={onSendSuggestion}
          />
        ) : (
          <>
            {lastAnswerFailed && (
              <div className="ask-recovery-banner">
                <div>
                  <div className="ask-recovery-title">上一次问答没有完成</div>
                  <div className="ask-recovery-copy">
                    通常是 API 配置或服务端暂时不可用。可以重新开始，也可以保留记录继续问。
                  </div>
                </div>
                <button
                  className="ask-reset-btn ask-recovery-action"
                  onClick={() => void onRestart()}
                  type="button"
                >
                  重新开始
                </button>
              </div>
            )}
            {history?.map((message, index) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="msg msg-user-row">
                    <div className="msg-user">{message.text}</div>
                  </div>
                );
              }

              const previous = history[index - 1];
              const userQuestion = previous?.role === 'user' ? previous.text : null;
              const failedAnswer = isAskFailureMessage(message.text);
              const failureDetail = failedAnswer ? getAskFailureDetail(message.text) : '';
              return (
                <div key={message.id} className="msg msg-ai-row">
                  <div className={`msg-ai-card${failedAnswer ? ' ask-failure-card' : ''}`}>
                    <div className="msg-ai-label">Wiki 答案</div>
                    {!failedAnswer && message.stages && message.stages.length > 0 && (
                      <ThinkingTrace stages={message.stages} />
                    )}
                    {failedAnswer ? (
                      <div className="ask-failure-copy">
                        <div className="ask-failure-title">问答暂时没成功</div>
                        <p>
                          通常是模型 API
                          或服务端配置暂时不可用。你可以检查设置里的模型配置，或者稍后重新提问。
                        </p>
                        <div className="ask-failure-actions">
                          {userQuestion && (
                            <button
                              type="button"
                              className="ask-failure-primary"
                              disabled={loading}
                              onClick={() => void onSendSuggestion(userQuestion)}
                            >
                              重新提问
                            </button>
                          )}
                          <button
                            type="button"
                            className="ask-reset-btn"
                            onClick={() => void onRestart()}
                          >
                            新对话
                          </button>
                        </div>
                        {failureDetail && (
                          <details className="ask-failure-details">
                            <summary className="ask-failure-summary">查看详情</summary>
                            <pre className="ask-failure-detail">{failureDetail}</pre>
                          </details>
                        )}
                      </div>
                    ) : (
                      <>
                        <Prose
                          markdown={formatConceptBodyForDisplay(message.text)}
                          citedConceptIds={message.citedConcepts}
                          className="prose-answer"
                        />
                        {message.faithfulness?.level === 'low' && (
                          <div
                            className="msg-sources ask-low-confidence"
                            role="note"
                            title={`检索置信度评分 ${message.faithfulness.score.toFixed(1)}`}
                          >
                            <div className="ms-label">匹配度偏低</div>
                            <div>本回答的检索依据不够充分，建议结合资料原文再判断。</div>
                          </div>
                        )}
                      </>
                    )}
                    {!failedAnswer && message.citedConcepts && message.citedConcepts.length > 0 && (
                      <div className="msg-sources">
                        <div className="ms-label">基于概念页</div>
                        <CitedList ids={message.citedConcepts} onClick={onOpenConcept} />
                      </div>
                    )}
                    <div className="msg-answer-actions">
                      {!failedAnswer &&
                        message.citedConcepts &&
                        message.citedConcepts.length > 0 &&
                        (message.savedAsConceptId ? (
                          <button className="save-as-page" disabled type="button">
                            <Icon.Save />
                            已归档为 Wiki 页面
                          </button>
                        ) : (
                          <button
                            className="save-as-page"
                            disabled={archiving === message.id}
                            onClick={() => void onArchive(message, userQuestion)}
                            type="button"
                          >
                            <Icon.Save />
                            {archiving === message.id ? '归档中...' : '归档为新页面'}
                          </button>
                        ))}
                      <button
                        className="save-as-page"
                        type="button"
                        onClick={() => void onRestart()}
                        disabled={loading}
                        aria-label="开始新对话"
                      >
                        <Icon.Plus />
                        <span>新对话</span>
                      </button>
                    </div>
                    {!failedAnswer &&
                      message.suggestedQuestions &&
                      message.suggestedQuestions.length > 0 && (
                        <div className="msg-follow-ups">
                          <div className="msg-follow-ups-label">
                            <Icon.Sparkle />
                            <span>你可能还想问</span>
                          </div>
                          {message.suggestedQuestions.map((q) => (
                            <button
                              key={q}
                              className="msg-follow-up-q"
                              onClick={() => void onSendSuggestion(q)}
                              type="button"
                              disabled={loading}
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                  </div>
                </div>
              );
            })}
            {loading && streamingText && (
              <div className="msg msg-ai-row">
                <div className="msg-ai-card">
                  <div className="msg-ai-label loading">Wiki 答案</div>
                  {liveStages.length > 0 && <ThinkingTrace stages={liveStages} />}
                  <Prose
                    markdown={formatConceptBodyForDisplay(streamingText)}
                    className="prose-answer"
                  />
                </div>
              </div>
            )}
            {loading && !streamingText && (
              <div className="msg msg-ai-row">
                <div className="msg-ai-card loading">
                  <ThinkingPanel stages={liveStages} conceptCount={conceptCount} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CitedList({ ids, onClick }: { ids: string[]; onClick: (id: string) => void }) {
  const concepts = useLiveQuery(async () => {
    const items = await getDb().concepts.bulkGet(ids);
    return items.filter(Boolean);
  }, [ids.join(',')]);

  if (!concepts) return null;
  return (
    <>
      {concepts.map((concept) => (
        <button
          key={concept!.id}
          className="ms-item"
          onClick={() => onClick(concept!.id)}
          type="button"
        >
          {concept!.title}
        </button>
      ))}
    </>
  );
}

function isAskFailureMessage(text: string) {
  const normalized = text.trim();
  // 用结构化标记/固定前缀判定，避免正常回答中引用「问答失败」一词被误判
  return normalized.startsWith('**问答失败**') || normalized.includes('<!-- error-detail:');
}

function getAskFailureDetail(text: string) {
  // Extract raw detail from <!-- error-detail:... --> or <!-- raw:... --> comment
  const detailMatch = text.match(/<!-- (?:error-detail|raw):([\s\S]*?) -->/);
  if (detailMatch) return detailMatch[1].trim();
  // Fallback: strip the known wrappers
  return text
    .replace(/^\*\*问答失败\*\*:\s*/u, '')
    .replace(/\n\n请检查 API 配置[\s\S]*$/u, '')
    .replace(/\n\n<!-- [\s\S]*$/u, '')
    .trim();
}
