import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';

import { WikiExportPanel } from './WikiExportPanel';

test('WikiExportPanel shows last export time and a download action', () => {
  const html = renderToStaticMarkup(
    <WikiExportPanel
      loading={false}
      error={null}
      lastExportLabel="3 分钟前 · 12 个文件"
      onExport={() => {}}
    />,
  );

  assert.match(html, /导出 Wiki Markdown/);
  assert.match(html, /最近导出：3 分钟前 · 12 个文件/);
  assert.match(html, />导出 Wiki</);
  assert.doesNotMatch(html, /还没有成功导出记录/);
});

test('WikiExportPanel surfaces export errors and a retryable idle button', () => {
  const html = renderToStaticMarkup(
    <WikiExportPanel
      loading={false}
      error="Wiki 导出失败 (500)"
      lastExportLabel={null}
      onExport={() => {}}
    />,
  );

  assert.match(html, /Wiki 导出失败 \(500\)/);
  assert.match(html, /role="alert"/);
  assert.match(html, /还没有成功导出记录/);
});

test('WikiExportPanel disables the action while exporting', () => {
  const html = renderToStaticMarkup(
    <WikiExportPanel loading error={null} lastExportLabel={null} onExport={() => {}} />,
  );

  assert.match(html, /导出中…/);
  assert.match(html, /disabled/);
  assert.match(html, /aria-busy="true"/);
});
