import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWikiExportFilename,
  readLastWikiExport,
  serializeWikiExport,
  writeLastWikiExport,
} from './wiki-export-client';

test('buildWikiExportFilename uses a stable UTC stamp', () => {
  assert.equal(
    buildWikiExportFilename(new Date('2026-08-27T06:44:19.903Z')),
    'compound-wiki-export-2026-08-27T06-44-19.json',
  );
});

test('serializeWikiExport writes the import-compatible JSON payload', () => {
  const payload = serializeWikiExport([
    { path: 'wiki/index.md', content: '# Index' },
    { path: 'wiki/concepts/c-1.md', content: '# Concept' },
  ]);
  assert.deepEqual(JSON.parse(payload), {
    ok: true,
    files: [
      { path: 'wiki/index.md', content: '# Index' },
      { path: 'wiki/concepts/c-1.md', content: '# Concept' },
    ],
  });
});

test('readLastWikiExport rejects malformed records', () => {
  assert.equal(readLastWikiExport(null), null);
  assert.equal(readLastWikiExport('{'), null);
  const record = { at: 1_700_000_000_000, fileCount: 4, filename: 'compound-wiki-export.json' };
  assert.deepEqual(readLastWikiExport(writeLastWikiExport(record)), record);
});
