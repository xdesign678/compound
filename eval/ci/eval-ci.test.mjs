import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GATE, loadFixture, runEvalCi, runEvalCiFromFile } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const corpusPath = path.join(repoRoot, 'eval/fixtures/ci-corpus.json');
const cliPath = path.join(repoRoot, 'scripts/eval-ci.mjs');

function cloneCorpus() {
  return structuredClone(loadFixture(corpusPath));
}

function itemById(doc, id) {
  return doc.items.find((item) => item.id === id);
}

function doneData(item) {
  return item.expectedOutput.sseEvents.find((event) => event.event === 'done').data;
}

function writeTempFixture(doc) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compound-eval-ci-'));
  const filePath = path.join(dir, 'ci-corpus.json');
  writeFileSync(filePath, `${JSON.stringify(doc)}\n`);
  return filePath;
}

function spawnCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('checked-in fixture passes every hard gate', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('eval:ci must not use the network');
  };
  try {
    const result = runEvalCiFromFile(corpusPath);
    assert.equal(result.ok, true, result.failures.map((row) => row.message).join('\n'));
    assert.equal(result.exitCode, 0);
    assert.equal(result.hardGates[GATE.PARSE_OR_RUN].pass, true);
    assert.equal(result.hardGates[GATE.CITATION_RESOLVABLE].pass, true);
    assert.equal(result.hardGates[GATE.GRAPH_CONNECTED].pass, true);
    assert.equal(result.hardGates[GATE.SSE_DONE_COMPLETE].pass, true);
    assert.equal(result.hardGates[GATE.UNKNOWN_WITHOUT_CITATION].pass, true);
    assert.ok(result.hopCounts['one-hop'] >= 1);
    assert.ok(result.hopCounts['multi-hop'] >= 1);
    assert.ok(result.hopCounts.unknown >= 1);
    assert.ok(result.entityCounts.sources >= 1);
    assert.ok(result.entityCounts.concepts >= 1);
    assert.ok(result.entityCounts.chunks >= 1);
    assert.ok(result.entityCounts.evidence >= 1);
    assert.equal(result.reportOnly.hitAt1, 1);
    assert.equal(result.reportOnly.keywordRecall, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CLI exits 0 on the checked-in fixture', () => {
  const child = spawnCli([]);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.match(child.stdout, /\[eval:ci\] PASS/);
  assert.match(child.stdout, /Report-only \(not gated\)/);
});

test('CLI refuses the production-matching golden set', () => {
  const child = spawnCli(['--corpus', 'eval/golden-set.json']);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /refused/);
});

test('parse error is a non-zero parse/run failure', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'compound-eval-ci-parse-'));
  const filePath = path.join(dir, 'broken.json');
  writeFileSync(filePath, '{ not json');
  const result = runEvalCiFromFile(filePath);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.hardGates[GATE.PARSE_OR_RUN].pass, false);
  assert.ok(result.failures.some((row) => /parse error/i.test(row.message)));

  const child = spawnCli(['--corpus', filePath]);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /\[eval:ci\] FAIL/);
});

test('dangling citation id fails citation resolvable', () => {
  const doc = cloneCorpus();
  const item = itemById(doc, 'fixture-definition-001');
  doneData(item).citedConceptIds = ['c-does-not-exist'];
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.CITATION_RESOLVABLE].pass, false);
  assert.ok(result.failures.some((row) => row.message.includes('c-does-not-exist')));
});

test('wrong-type citation id fails citation resolvable', () => {
  const doc = cloneCorpus();
  const item = itemById(doc, 'fixture-definition-001');
  doneData(item).citedConceptIds = ['s-fixture-alpha'];
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.CITATION_RESOLVABLE].pass, false);
  assert.ok(
    result.failures.some(
      (row) => row.gate === GATE.CITATION_RESOLVABLE && row.message.includes('s-fixture-alpha'),
    ),
  );
});

test('answerable item requires concept, source, chunk, and evidence citations', () => {
  const doc = cloneCorpus();
  const item = itemById(doc, 'fixture-definition-001');
  const data = doneData(item);
  data.citedSourceIds = [];
  data.citedChunkIds = [];
  data.citedEvidenceIds = [];
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.CITATION_RESOLVABLE].pass, false);
  assert.ok(result.failures.some((row) => row.message.includes('at least one source')));
  assert.ok(result.failures.some((row) => row.message.includes('at least one chunk')));
  assert.ok(result.failures.some((row) => row.message.includes('at least one evidence')));
});

test('expected citation ids must be present in the done payload', () => {
  const doc = cloneCorpus();
  const item = itemById(doc, 'fixture-definition-001');
  doneData(item).citedEvidenceIds = ['e-fixture-beta-1'];
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.CITATION_RESOLVABLE].pass, false);
  assert.ok(result.failures.some((row) => row.message.includes('e-fixture-alpha-1')));
});

test('broken source/chunk/evidence connectivity fails', () => {
  const doc = cloneCorpus();
  const chunk = doc.chunks.find((row) => row.id === 'k-fixture-alpha-1');
  chunk.sourceId = 's-missing';
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.GRAPH_CONNECTED].pass, false);
  assert.ok(result.failures.some((row) => row.message.includes('k-fixture-alpha-1')));
});

test('evidence pointing at a chunk from another source fails connectivity', () => {
  const doc = cloneCorpus();
  const evidence = doc.evidence.find((row) => row.id === 'e-fixture-alpha-1');
  evidence.chunkId = 'k-fixture-beta-1';
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.GRAPH_CONNECTED].pass, false);
  assert.ok(
    result.failures.some(
      (row) => row.gate === GATE.GRAPH_CONNECTED && row.message.includes('e-fixture-alpha-1'),
    ),
  );
});

test('multi-hop citations require a connected concept subgraph', () => {
  const doc = cloneCorpus();
  doc.relations = [];
  for (const concept of doc.concepts) concept.related = [];
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.GRAPH_CONNECTED].pass, false);
  assert.ok(
    result.failures.some((row) => row.message.includes('cited concepts are not connected')),
  );
});

test('unknown item that forges a citation fails', () => {
  const doc = cloneCorpus();
  const item = itemById(doc, 'fixture-unknown-001');
  const data = doneData(item);
  data.citedConceptIds = ['c-fixture-alpha'];
  data.citedSourceIds = ['s-fixture-alpha'];
  data.citedChunkIds = ['k-fixture-alpha-1'];
  data.citedEvidenceIds = ['e-fixture-alpha-1'];
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.UNKNOWN_WITHOUT_CITATION].pass, false);
  assert.ok(result.failures.some((row) => row.message.includes('fixture-unknown-001')));
});

test('missing SSE done event fails the done contract', () => {
  const doc = cloneCorpus();
  const item = itemById(doc, 'fixture-definition-001');
  item.expectedOutput.sseEvents = item.expectedOutput.sseEvents.filter(
    (event) => event.event !== 'done',
  );
  const result = runEvalCi(doc);
  assert.equal(result.ok, false);
  assert.equal(result.hardGates[GATE.SSE_DONE_COMPLETE].pass, false);
  assert.ok(result.failures.some((row) => /missing event: done/.test(row.message)));
});

test('CLI exits 1 when a mutated fixture fails a hard gate', () => {
  const doc = cloneCorpus();
  itemById(doc, 'fixture-definition-001').expectedOutput.sseEvents = [];
  const filePath = writeTempFixture(doc);
  const child = spawnCli(['--corpus', filePath]);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /SSE done complete\s+FAIL/);
});
