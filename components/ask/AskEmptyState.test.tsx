import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { AskEmptyState } from './AskEmptyState';

test('AskEmptyState renders suggestions when wiki has concepts', () => {
  const html = renderToStaticMarkup(
    <AskEmptyState
      conceptCount={3}
      suggestions={['Alpha 是什么？', 'Beta 和 Gamma 有什么关系？']}
      onSend={() => {}}
    />,
  );

  assert.match(html, /知识提问/);
  assert.match(html, /Alpha 是什么/);
  assert.match(html, /Beta 和 Gamma/);
  assert.doesNotMatch(html, /Wiki 当前为空/);
});

test('AskEmptyState tells the user when wiki is empty', () => {
  const html = renderToStaticMarkup(
    <AskEmptyState conceptCount={0} suggestions={[]} onSend={() => {}} />,
  );

  assert.match(html, /Wiki 当前为空/);
});
