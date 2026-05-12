import test from 'node:test';
import assert from 'node:assert/strict';

import {
  splitMarkdownBlocks,
  joinBlocksToMarkdown,
  extractFrontmatterTags,
  replaceBlockRaw,
} from './block-split';

test('split and join round-trip for paragraphs + heading + list', () => {
  const md = '# Hello\n\nThis is a paragraph.\n\n- Item one\n- Item two\n\nAnother paragraph.\n';
  const blocks = splitMarkdownBlocks(md, 'Hello');
  assert.ok(blocks.length >= 4, 'should have at least heading + 2 paragraphs + list');

  const joined = joinBlocksToMarkdown(blocks);
  assert.equal(joined, md);
});

test('leading-title detection', () => {
  const md = '# My Title\n\nSome body text.\n';
  const blocks = splitMarkdownBlocks(md, 'My Title');
  const heading = blocks[0];
  assert.equal(heading.type, 'heading');
  assert.equal(heading.kind, 'leading-title');
});

test('leading-title does not match different title', () => {
  const md = '# My Title\n\nSome body text.\n';
  const blocks = splitMarkdownBlocks(md, 'Different Title');
  const heading = blocks[0];
  assert.equal(heading.type, 'heading');
  assert.equal(heading.kind, 'normal');
});

test('extractFrontmatterTags returns correct tags', () => {
  const md = 'tags: [foo, bar, baz]\n\nSome text.\n';
  const blocks = splitMarkdownBlocks(md, '');
  const tags = extractFrontmatterTags(blocks);
  assert.deepEqual(tags, ['foo', 'bar', 'baz']);
});

test('extractFrontmatterTags handles quoted tags', () => {
  const md = 'Tags: ["hello world", foo]\n\nSome text.\n';
  const blocks = splitMarkdownBlocks(md, '');
  const tags = extractFrontmatterTags(blocks);
  assert.deepEqual(tags, ['hello world', 'foo']);
});

test('extractFrontmatterTags returns empty array when no tags', () => {
  const md = '# Heading\n\nSome text.\n';
  const blocks = splitMarkdownBlocks(md, 'Heading');
  const tags = extractFrontmatterTags(blocks);
  assert.deepEqual(tags, []);
});

test('replaceBlockRaw updates only target block', () => {
  const md = 'Para one\n\nPara two\n\nPara three\n';
  const blocks = splitMarkdownBlocks(md, '');
  const originalIds = blocks.map((b) => b.id);
  const replaced = replaceBlockRaw(blocks, blocks[1].id, 'Updated two\n\n');

  assert.equal(replaced[0].raw, blocks[0].raw);
  assert.equal(replaced[0].id, blocks[0].id);
  assert.equal(replaced[1].raw, 'Updated two\n\n');
  assert.equal(replaced[1].id, blocks[1].id);
  assert.equal(replaced[2].raw, blocks[2].raw);
  assert.equal(replaced[2].id, blocks[2].id);

  // Other block ids unchanged
  assert.equal(replaced[0].id, originalIds[0]);
  assert.equal(replaced[2].id, originalIds[2]);
});

test('split handles blockquote and code', () => {
  const md = '> Quote line\n\n```js\nconst x = 1;\n```\n\nPlain text.\n';
  const blocks = splitMarkdownBlocks(md, '');
  const types = blocks.map((b) => b.type);
  assert.ok(types.includes('blockquote'));
  assert.ok(types.includes('code'));
  assert.ok(types.includes('paragraph'));

  const joined = joinBlocksToMarkdown(blocks);
  assert.equal(joined, md);
});

test('stable ids for identical input', () => {
  const md = '# Title\n\nParagraph.\n';
  const blocksA = splitMarkdownBlocks(md, 'Title');
  const blocksB = splitMarkdownBlocks(md, 'Title');
  assert.deepEqual(
    blocksA.map((b) => b.id),
    blocksB.map((b) => b.id),
  );
});
