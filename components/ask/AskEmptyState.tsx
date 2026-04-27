'use client';

import { Icon } from '../Icons';

export function AskEmptyState({
  conceptCount,
  suggestions,
  onSend,
}: {
  conceptCount: number;
  suggestions: string[];
  onSend: (text: string) => void | Promise<void>;
}) {
  return (
    <div className="ask-empty">
      <div className="ask-empty-kicker">知识提问</div>
      <div className="big-icon">
        <Icon.Sparkle />
      </div>
      <h3>从你的 Wiki 问起</h3>
      <p>
        答案从已综合的概念页中提取,带引用。好的回答可以归档为新页面。
        {conceptCount === 0 && (
          <>
            <br />
            <br />
            <strong>Wiki 当前为空</strong>,请先添加一些资料。
          </>
        )}
      </p>
      {suggestions.length > 0 && (
        <div className="suggested-questions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              className="suggested-q"
              onClick={() => void onSend(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
