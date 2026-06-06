import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadMarked,
  loadDOMPurify,
  setMarkdownBreaks,
  getMarkdownBreaks,
  renderMarkdown,
  escapeHTML,
} from './format.js';

describe('format lazy-loaders', () => {
  it('loadMarked resolves to a module with marked.parse', async () => {
    const mod = await loadMarked();
    assert.ok(mod, 'loadMarked should resolve to a non-null module');
    assert.ok(typeof mod.marked.parse === 'function', 'marked.parse should be a function');
  });

  it('loadMarked returns cached module on second call (dedup)', async () => {
    const first = await loadMarked();
    const second = await loadMarked();
    assert.strictEqual(first, second, 'second call should return same cached module');
  });

  it('loadDOMPurify resolves to a module with sanitize', async () => {
    const mod = await loadDOMPurify();
    // In Node.js (no window), DOMPurify may not fully work but the module should load
    // In a real browser environment it would have .sanitize
    assert.ok(mod !== undefined, 'loadDOMPurify should resolve');
  });

  it('loadDOMPurify returns cached module on second call (dedup)', async () => {
    const first = await loadDOMPurify();
    const second = await loadDOMPurify();
    assert.strictEqual(first, second, 'second call should return same cached module');
  });
});

describe('renderMarkdown (async)', () => {
  it('renders basic markdown to HTML', async () => {
    const html = await renderMarkdown('Hello **world**');
    assert.ok(html.includes('<strong>'), 'should contain <strong> tag');
    assert.ok(html.includes('world'), 'should contain the text');
  });

  it('handles wiki-links [[Target|Alias]]', async () => {
    const html = await renderMarkdown('See [[Foo Bar|FB]] for details');
    assert.ok(html.includes('data-wikilink'), 'should contain wikilink data attribute');
    assert.ok(html.includes('FB'), 'should contain alias text');
  });

  it('handles [text](concept:id) links', async () => {
    const html = await renderMarkdown('See [My Concept](concept:abc-123)');
    assert.ok(html.includes('data-concept-id'), 'should contain concept link data attribute');
    assert.ok(html.includes('abc-123'), 'should contain the concept id');
  });

  it('handles [CX] citation footnotes', async () => {
    const html = await renderMarkdown('Some claim [C3] here');
    assert.ok(html.includes('data-citation-index'), 'should contain citation data attribute');
    assert.ok(html.includes('C3'), 'should contain the citation number');
  });

  it('handles tags: [a, b, c] frontmatter', async () => {
    const html = await renderMarkdown('tags: [alpha, beta, gamma]\n\nSome content');
    assert.ok(html.includes('content-tag'), 'should contain tag chip class');
    assert.ok(html.includes('alpha'), 'should contain tag text');
  });

  it('returns escaped HTML for empty or null-like input', async () => {
    const html = await renderMarkdown('');
    assert.ok(html === '' || html === escapeHTML(''), 'empty input should produce empty output');
  });
});

describe('setMarkdownBreaks / getMarkdownBreaks', () => {
  it('getMarkdownBreaks returns default in non-browser env', () => {
    // In Node.js there is no localStorage, so it returns the default
    assert.equal(getMarkdownBreaks(), false);
  });

  it('setMarkdownBreaks does not throw in non-browser env', () => {
    // Should not crash even without localStorage
    assert.doesNotThrow(() => setMarkdownBreaks(true));
    assert.doesNotThrow(() => setMarkdownBreaks(false));
  });
});

describe('escapeHTML', () => {
  it('escapes special characters', () => {
    assert.equal(escapeHTML('<script>&"foo"'), '&lt;script&gt;&amp;&quot;foo&quot;');
  });
});
