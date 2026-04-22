import test from 'node:test';
import assert from 'node:assert/strict';

import { splitMarkdownIntoChunks } from './wiki-chunk';

test('splitMarkdownIntoChunks 保留标题路径并为长段落切块', () => {
  const markdown = `# Alpha

第一段说明 Alpha 的背景与范围。

第二段继续描述 Alpha 的细节，并补充更多上下文。

第三段继续延展，让正文足够长，确保会发生切块。

第四段继续延展，让正文足够长，确保会发生切块。

第五段继续延展，让正文足够长，确保会发生切块。`;

  const chunks = splitMarkdownIntoChunks(markdown, {
    maxTokens: 40,
    overlapTokens: 10,
    minChunkChars: 10,
  });

  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0]?.heading, 'Alpha');
  assert.deepEqual(chunks[0]?.headingPath, ['Alpha']);
  assert.match(chunks[0]?.content ?? '', /路径：Alpha/);
  assert.match(chunks[1]?.content ?? '', /路径：Alpha/);
});

test('splitMarkdownIntoChunks 保留嵌套标题层级', () => {
  const markdown = `# 总览

总览内容。

## 第二层

第二层内容。

### 第三层

第三层内容。`;

  const chunks = splitMarkdownIntoChunks(markdown, {
    maxTokens: 200,
    overlapTokens: 0,
    minChunkChars: 1,
  });

  const nestedChunk = chunks.find((chunk) => chunk.heading === '第三层');
  assert.ok(nestedChunk);
  assert.deepEqual(nestedChunk?.headingPath, ['总览', '第二层', '第三层']);
  assert.match(nestedChunk?.content ?? '', /路径：总览 \/ 第二层 \/ 第三层/);
});
