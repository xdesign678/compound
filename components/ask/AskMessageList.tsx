'use client';

import type { RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../lib/db';
import { formatConceptBodyForDisplay } from '../../lib/concept-body-format';
import type { AskMessage } from '../../lib/types';
import { Icon } from '../Icons';
import { Prose } from '../Prose';
import { AskEmptyState } from './AskEmptyState';

export function AskMessageList({
  history,
  loading,
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
  conceptCount: number | undefined;
  suggestions: string[];
  archiving: string | null;
  messagesRef: RefObject<HTMLDivElement>;
  onSendSuggestion: (text: string) => void | Promise<void>;
  onRestart: () => void;
  onArchive: (message: AskMessage, userQuestion: string | null) => void | Promise<void>;
  onOpenConcept: (id: string) => void;
}) {
  const lastAnswerFailed = (() => {
    const lastAnswer = [...(history ?? [])].reverse().find((message) => message.role === 'ai');
    return lastAnswer ? isAskFailureMessage(lastAnswer.text) : false;
  })();

  return (
    <div className="ask-messages" ref={messagesRef}>
      <div className="ask-stream">
        {history && history.length === 0 && !loading ? (
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
                <button className="ask-reset-btn ask-recovery-action" onClick={onRestart}>
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
              return (
                <div key={message.id} className="msg msg-ai-row">
                  <div className={`msg-ai-card${failedAnswer ? ' ask-failure-card' : ''}`}>
                    <div className="msg-ai-label">Wiki 答案</div>
                    {failedAnswer ? (
                      <div className="ask-failure-copy">
                        <div className="ask-failure-title">问答暂时没成功</div>
                        <p>
                          通常是模型 API
                          或服务端配置暂时不可用。你可以检查设置里的模型配置，或者稍后重新提问。
                        </p>
                      </div>
                    ) : (
                      <Prose
                        markdown={formatConceptBodyForDisplay(message.text)}
                        citedConceptIds={message.citedConcepts}
                        className="prose-answer"
                      />
                    )}
                    {!failedAnswer && message.citedConcepts && message.citedConcepts.length > 0 && (
                      <div className="msg-sources">
                        <div className="ms-label">基于概念页</div>
                        <CitedList ids={message.citedConcepts} onClick={onOpenConcept} />
                      </div>
                    )}
                    {!failedAnswer &&
                      message.citedConcepts &&
                      message.citedConcepts.length > 0 &&
                      (message.savedAsConceptId ? (
                        <button className="save-as-page" disabled>
                          <Icon.Save />
                          已归档为 Wiki 页面
                        </button>
                      ) : (
                        <button
                          className="save-as-page"
                          disabled={archiving === message.id}
                          onClick={() => void onArchive(message, userQuestion)}
                        >
                          <Icon.Save />
                          {archiving === message.id ? '归档中...' : '归档为新页面'}
                        </button>
                      ))}
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
      {concepts.map((concept) => (
        <button key={concept!.id} className="ms-item" onClick={() => onClick(concept!.id)}>
          {concept!.title}
        </button>
      ))}
    </>
  );
}

function isAskFailureMessage(text: string) {
  const normalized = text.trim();
  return normalized.includes('问答失败') || normalized.includes('/api/query failed');
}
