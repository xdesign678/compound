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

test('splitMarkdownIntoChunks covers Obsidian-flavored markdown fixtures with stable metadata', () => {
  const markdown = `---
title: Obsidian Fixture
tags: [compound, llm-wiki]
aliases:
  - Fixture Alias
---

# Vault Root

这里有 [[Linked Concept|别名链接]]、#project/compound 标签和 ![[assets/diagram.png]] 嵌入。

> [!note] Callout title
> callout 正文会保留为普通 Markdown 内容。

## Area

### Deep Heading

深层标题内容，引用 [[Another Note]] 和本地资源 [asset](assets/local.pdf)。`;

  const chunks = splitMarkdownIntoChunks(markdown, {
    maxTokens: 240,
    overlapTokens: 0,
    minChunkChars: 1,
  });

  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0]?.heading, '未命名片段');
  assert.deepEqual(chunks[0]?.headingPath, ['未命名片段']);
  assert.match(chunks[0]?.content ?? '', /title: Obsidian Fixture/);
  assert.match(chunks[0]?.content ?? '', /tags: \[compound, llm-wiki\]/);

  const root = chunks.find((chunk) => chunk.heading === 'Vault Root');
  assert.ok(root);
  assert.deepEqual(root?.headingPath, ['Vault Root']);
  assert.match(root?.content ?? '', /\[\[Linked Concept\|别名链接\]\]/);
  assert.match(root?.content ?? '', /!\[\[assets\/diagram\.png\]\]/);
  assert.match(root?.content ?? '', /> \[!note\] Callout title/);

  const deep = chunks.find((chunk) => chunk.heading === 'Deep Heading');
  assert.ok(deep);
  assert.deepEqual(deep?.headingPath, ['Vault Root', 'Area', 'Deep Heading']);
  assert.match(deep?.content ?? '', /路径：Vault Root \/ Area \/ Deep Heading/);
  assert.match(deep?.content ?? '', /\[asset\]\(assets\/local\.pdf\)/);
  assert.match(deep?.contentHash ?? '', /^[a-f0-9]{64}$/);
});
