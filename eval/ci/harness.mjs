/**
 * Deterministic CI eval harness.
 *
 * Zero network, zero real models, no production golden set. The fixture's
 * expectedOutput is the query/output contract; a local lexical retriever
 * only feeds report-only hit@k / MRR / keyword metrics.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const GATE = {
  PARSE_OR_RUN: 'parseOrRun',
  CITATION_RESOLVABLE: 'citationResolvable',
  GRAPH_CONNECTED: 'graphConnected',
  SSE_DONE_COMPLETE: 'sseDoneComplete',
  UNKNOWN_WITHOUT_CITATION: 'unknownWithoutCitation',
};

export const HOP_KINDS = ['one-hop', 'multi-hop', 'unknown'];

export const CITATION_KEYS = [
  'citedConceptIds',
  'citedSourceIds',
  'citedChunkIds',
  'citedEvidenceIds',
];

export const REQUIRED_DONE_FIELDS = [
  ...CITATION_KEYS,
  'archivable',
  'suggestedQuestions',
  'stageDurations',
];

const FORBIDDEN_TEXT = /compund\.zeabur|production incident id/i;
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'do',
  'from',
  'how',
  'in',
  'is',
  'of',
  'or',
  'the',
  'this',
  'to',
  'what',
]);

export function loadFixture(filePath) {
  const resolved = path.resolve(filePath);
  let raw;
  try {
    raw = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new Error(
      `failed to read fixture: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `fixture JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('fixture must be a JSON object');
  }
  return parsed;
}

export function runEvalCiFromFile(filePath) {
  try {
    const doc = loadFixture(filePath);
    return runEvalCi(doc, { corpusPath: path.resolve(filePath) });
  } catch (error) {
    return failParseOrRun(error instanceof Error ? error.message : String(error), {
      corpusPath: path.resolve(filePath),
    });
  }
}

export function runEvalCi(doc, options = {}) {
  try {
    return evaluateFixture(doc, options);
  } catch (error) {
    return failParseOrRun(error instanceof Error ? error.message : String(error), options);
  }
}

export function formatReport(result) {
  const gateLine = (id, label) => {
    const gate = result.hardGates[id];
    const status = gate.pass ? 'PASS' : 'FAIL';
    const extra = gate.detail ? `  ${gate.detail}` : '';
    return `  ${label.padEnd(28)} ${status}${extra}`;
  };
  const pct = (n) => (Number.isFinite(n) ? n.toFixed(3) : 'n/a');
  const lines = [
    `[eval:ci] corpus: ${result.corpusPath || '(in-memory)'}`,
    `[eval:ci] items: ${result.itemCount} (${formatHopCounts(result.hopCounts)})`,
    `[eval:ci] entities: ${formatEntityCounts(result.entityCounts)}`,
    '',
    'Hard gates',
    gateLine(GATE.PARSE_OR_RUN, 'parse/run errors'),
    gateLine(GATE.CITATION_RESOLVABLE, 'citation resolvable'),
    gateLine(GATE.GRAPH_CONNECTED, 'graph connected'),
    gateLine(GATE.SSE_DONE_COMPLETE, 'SSE done complete'),
    gateLine(GATE.UNKNOWN_WITHOUT_CITATION, 'unknown without citation'),
    '',
    'Report-only (not gated)',
    `  hit@1                        ${pct(result.reportOnly.hitAt1)}`,
    `  hit@3                        ${pct(result.reportOnly.hitAt3)}`,
    `  hit@8                        ${pct(result.reportOnly.hitAt8)}`,
    `  MRR                          ${pct(result.reportOnly.mrr)}`,
    `  keyword recall               ${pct(result.reportOnly.keywordRecall)}`,
    '',
    `[eval:ci] ${result.ok ? 'PASS' : 'FAIL'}`,
  ];
  if (!result.ok) {
    for (const failure of result.failures) {
      lines.push(`  - [${failure.gate}] ${failure.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function publicReport(result) {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    corpusPath: result.corpusPath || null,
    itemCount: result.itemCount,
    hopCounts: result.hopCounts,
    entityCounts: result.entityCounts,
    hardGates: result.hardGates,
    reportOnly: result.reportOnly,
    failures: result.failures,
    items: (result.items || []).map((item) => ({
      id: item.id,
      hop: item.hop,
      citationResolved: item.citationResolved,
      citationTotal: item.citationTotal,
      hitAt1: item.hitAt1,
      hitAt3: item.hitAt3,
      hitAt8: item.hitAt8,
      mrr: item.mrr,
      keywordRecall: item.keywordRecall,
      hitSkipped: item.hitSkipped,
      keywordSkipped: item.keywordSkipped,
    })),
  };
}

function evaluateFixture(doc, options) {
  const failures = [];
  const push = (gate, message) => {
    failures.push({ gate, message });
  };

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    push(GATE.PARSE_OR_RUN, 'fixture must be a JSON object');
    return finalize(failures, options);
  }

  const sources = asArray(doc.sources, 'sources', push);
  const concepts = asArray(doc.concepts, 'concepts', push);
  const chunks = asArray(doc.chunks, 'chunks', push);
  const evidence = asArray(doc.evidence, 'evidence', push);
  const relations = asArray(doc.relations, 'relations', push);
  const items = asArray(doc.items, 'items', push);
  if (failures.some((f) => f.gate === GATE.PARSE_OR_RUN)) {
    return finalize(failures, options, { sources, concepts, chunks, evidence, relations, items });
  }

  if (sources.length === 0) push(GATE.PARSE_OR_RUN, 'sources must be a non-empty array');
  if (concepts.length === 0) push(GATE.PARSE_OR_RUN, 'concepts must be a non-empty array');
  if (chunks.length === 0) push(GATE.PARSE_OR_RUN, 'chunks must be a non-empty array');
  if (evidence.length === 0) push(GATE.PARSE_OR_RUN, 'evidence must be a non-empty array');
  if (items.length === 0) push(GATE.PARSE_OR_RUN, 'items must be a non-empty array');

  const indexes = indexEntities({ sources, concepts, chunks, evidence, relations }, push);
  validateCorpusGraph({ sources, concepts, chunks, evidence, relations, indexes }, push);
  scanForbiddenText(doc, push);

  const hopCounts = { 'one-hop': 0, 'multi-hop': 0, unknown: 0 };
  const itemScores = [];
  const seenItemIds = new Set();

  for (const [itemIndex, item] of items.entries()) {
    const itemPath = `items[${itemIndex}]`;
    if (!item || typeof item !== 'object') {
      push(GATE.PARSE_OR_RUN, `${itemPath} must be an object`);
      continue;
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      push(GATE.PARSE_OR_RUN, `${itemPath}.id is required`);
      continue;
    }
    if (seenItemIds.has(item.id)) {
      push(GATE.PARSE_OR_RUN, `duplicate item id ${item.id}`);
    }
    seenItemIds.add(item.id);

    const hop = item.hop;
    if (!HOP_KINDS.includes(hop)) {
      push(GATE.PARSE_OR_RUN, `${item.id} hop must be one of ${HOP_KINDS.join(', ')}`);
    } else {
      hopCounts[hop] += 1;
    }

    if (typeof item.question !== 'string' || item.question.length <= 8) {
      push(GATE.PARSE_OR_RUN, `${item.id} question must be longer than 8 characters`);
    }
    if (FORBIDDEN_TEXT.test(item.question || '')) {
      push(GATE.PARSE_OR_RUN, `${item.id} question is not de-identified`);
    }

    const shouldAnswer = item.shouldAnswer !== false;
    if (hop === 'unknown' && shouldAnswer) {
      push(GATE.PARSE_OR_RUN, `${item.id} hop=unknown requires shouldAnswer=false`);
    }
    if ((hop === 'one-hop' || hop === 'multi-hop') && item.shouldAnswer === false) {
      push(GATE.PARSE_OR_RUN, `${item.id} hop=${hop} requires shouldAnswer=true`);
    }
    if (shouldAnswer) {
      const hasIds = (item.expectedConceptIds ?? []).length > 0;
      const hasTitles = (item.expectedConceptTitles ?? []).length > 0;
      if (!hasIds && !hasTitles) {
        push(GATE.PARSE_OR_RUN, `${item.id} needs expected concept ids or titles`);
      }
    }
    if (hop === 'multi-hop' && (item.expectedConceptIds ?? []).length < 2) {
      push(GATE.PARSE_OR_RUN, `${item.id} multi-hop item needs at least two expectedConceptIds`);
    }

    const output = item.expectedOutput;
    if (!output || typeof output !== 'object') {
      push(GATE.PARSE_OR_RUN, `${item.id} expectedOutput is required`);
      itemScores.push(emptyItemScore(item));
      continue;
    }

    const done = extractDoneEvent(output, item.id, push);
    const citations = done ? collectCitations(done.data) : emptyCitations();
    validateAnswerMarkers(item, output.answer, citations.citedConceptIds, push);
    validateCitationResolution(item, citations, indexes, shouldAnswer, push);
    validateCitationGraph(item, citations, indexes, push);
    validateUnknownCitations(item, citations, output.answer, shouldAnswer, hop, push);

    const retrieved = rankConcepts(item.question || '', concepts, relations);
    const score = scoreItem(item, output.answer || '', retrieved);
    score.citationResolved = citations.resolvedCount;
    score.citationTotal = citations.totalCount;
    itemScores.push(score);
  }

  for (const kind of HOP_KINDS) {
    if (hopCounts[kind] < 1) {
      push(GATE.PARSE_OR_RUN, `fixture must include at least one ${kind} item`);
    }
  }

  return finalize(failures, options, {
    sources,
    concepts,
    chunks,
    evidence,
    relations,
    items,
    hopCounts,
    itemScores,
  });
}

function asArray(value, field, push) {
  if (value === undefined) {
    push(GATE.PARSE_OR_RUN, `${field} is required`);
    return [];
  }
  if (!Array.isArray(value)) {
    push(GATE.PARSE_OR_RUN, `${field} must be an array`);
    return [];
  }
  return value;
}

function indexEntities(groups, push) {
  const indexes = {
    sources: new Map(),
    concepts: new Map(),
    chunks: new Map(),
    evidence: new Map(),
    relations: new Map(),
  };
  const globalIds = new Map();
  for (const [kind, rows] of Object.entries(groups)) {
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== 'object') {
        push(GATE.PARSE_OR_RUN, `${kind}[${index}] must be an object`);
        continue;
      }
      if (typeof row.id !== 'string' || row.id.length === 0) {
        push(GATE.PARSE_OR_RUN, `${kind}[${index}].id is required`);
        continue;
      }
      if (indexes[kind].has(row.id)) {
        push(GATE.PARSE_OR_RUN, `duplicate ${kind} id ${row.id}`);
      }
      if (globalIds.has(row.id) && globalIds.get(row.id) !== kind) {
        push(
          GATE.PARSE_OR_RUN,
          `id ${row.id} is used by both ${globalIds.get(row.id)} and ${kind}`,
        );
      }
      indexes[kind].set(row.id, row);
      globalIds.set(row.id, kind);
    }
  }
  return indexes;
}

function validateCorpusGraph({ concepts, chunks, evidence, relations, indexes }, push) {
  for (const concept of concepts) {
    if (!concept?.id) continue;
    for (const sourceId of asIdList(concept.sources)) {
      if (!indexes.sources.has(sourceId)) {
        push(GATE.GRAPH_CONNECTED, `concept ${concept.id} sources[] missing source ${sourceId}`);
      }
    }
    for (const relatedId of asIdList(concept.related)) {
      if (!indexes.concepts.has(relatedId)) {
        push(GATE.GRAPH_CONNECTED, `concept ${concept.id} related[] missing concept ${relatedId}`);
      }
    }
  }

  for (const chunk of chunks) {
    if (!chunk?.id) continue;
    if (typeof chunk.sourceId !== 'string' || !indexes.sources.has(chunk.sourceId)) {
      push(GATE.GRAPH_CONNECTED, `chunk ${chunk.id} sourceId is not a known source`);
    }
  }

  for (const row of evidence) {
    if (!row?.id) continue;
    if (typeof row.conceptId !== 'string' || !indexes.concepts.has(row.conceptId)) {
      push(GATE.GRAPH_CONNECTED, `evidence ${row.id} conceptId is not a known concept`);
    }
    if (typeof row.sourceId !== 'string' || !indexes.sources.has(row.sourceId)) {
      push(GATE.GRAPH_CONNECTED, `evidence ${row.id} sourceId is not a known source`);
    }
    if (row.chunkId) {
      const chunk = indexes.chunks.get(row.chunkId);
      if (!chunk) {
        push(GATE.GRAPH_CONNECTED, `evidence ${row.id} chunkId is not a known chunk`);
      } else if (chunk.sourceId !== row.sourceId) {
        push(
          GATE.GRAPH_CONNECTED,
          `evidence ${row.id} chunk ${row.chunkId} belongs to ${chunk.sourceId}, not ${row.sourceId}`,
        );
      }
    }
  }

  for (const relation of relations) {
    if (!relation?.id) continue;
    if (
      typeof relation.sourceConceptId !== 'string' ||
      !indexes.concepts.has(relation.sourceConceptId)
    ) {
      push(GATE.GRAPH_CONNECTED, `relation ${relation.id} sourceConceptId is not a known concept`);
    }
    if (
      typeof relation.targetConceptId !== 'string' ||
      !indexes.concepts.has(relation.targetConceptId)
    ) {
      push(GATE.GRAPH_CONNECTED, `relation ${relation.id} targetConceptId is not a known concept`);
    }
  }
}

function extractDoneEvent(output, itemId, push) {
  if (!Array.isArray(output.sseEvents)) {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} expectedOutput.sseEvents must be an array`);
    return null;
  }
  const doneEvents = output.sseEvents.filter((event) => event && event.event === 'done');
  if (doneEvents.length === 0) {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} SSE transcript is missing event: done`);
    return null;
  }
  if (doneEvents.length > 1) {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} SSE transcript has multiple event: done`);
  }
  const done = doneEvents[0];
  if (!done.data || typeof done.data !== 'object' || Array.isArray(done.data)) {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} event: done data must be an object`);
    return null;
  }
  for (const field of REQUIRED_DONE_FIELDS) {
    if (!(field in done.data)) {
      push(GATE.SSE_DONE_COMPLETE, `${itemId} event: done missing ${field}`);
    }
  }
  for (const key of CITATION_KEYS) {
    if (key in done.data && !isStringArray(done.data[key])) {
      push(GATE.SSE_DONE_COMPLETE, `${itemId} event: done ${key} must be an array of strings`);
    }
  }
  if ('archivable' in done.data && typeof done.data.archivable !== 'boolean') {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} event: done archivable must be boolean`);
  }
  if ('suggestedQuestions' in done.data && !Array.isArray(done.data.suggestedQuestions)) {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} event: done suggestedQuestions must be an array`);
  }
  if (
    'stageDurations' in done.data &&
    (!done.data.stageDurations ||
      typeof done.data.stageDurations !== 'object' ||
      Array.isArray(done.data.stageDurations))
  ) {
    push(GATE.SSE_DONE_COMPLETE, `${itemId} event: done stageDurations must be an object`);
  }
  return done;
}

function collectCitations(doneData) {
  const citedConceptIds = asIdList(doneData?.citedConceptIds);
  const citedSourceIds = asIdList(doneData?.citedSourceIds);
  const citedChunkIds = asIdList(doneData?.citedChunkIds);
  const citedEvidenceIds = asIdList(doneData?.citedEvidenceIds);
  return {
    citedConceptIds,
    citedSourceIds,
    citedChunkIds,
    citedEvidenceIds,
    totalCount:
      citedConceptIds.length +
      citedSourceIds.length +
      citedChunkIds.length +
      citedEvidenceIds.length,
    resolvedCount: 0,
  };
}

function emptyCitations() {
  return {
    citedConceptIds: [],
    citedSourceIds: [],
    citedChunkIds: [],
    citedEvidenceIds: [],
    totalCount: 0,
    resolvedCount: 0,
  };
}

function citationMarks(answer) {
  return [...String(answer).matchAll(/\[C(\d+)\]/g)].map((match) => Number(match[1]));
}

function validateAnswerMarkers(item, answer, citedConceptIds, push) {
  if (typeof answer !== 'string') {
    push(GATE.PARSE_OR_RUN, `${item.id} expectedOutput.answer must be a string`);
    return;
  }
  for (const n of citationMarks(answer)) {
    if (!Number.isInteger(n) || n < 1 || n > citedConceptIds.length) {
      push(
        GATE.CITATION_RESOLVABLE,
        `${item.id} answer marker [C${n}] does not resolve to citedConceptIds`,
      );
    }
  }
}

function validateCitationResolution(item, citations, indexes, shouldAnswer, push) {
  const checks = [
    ['citedConceptIds', citations.citedConceptIds, indexes.concepts, 'concept'],
    ['citedSourceIds', citations.citedSourceIds, indexes.sources, 'source'],
    ['citedChunkIds', citations.citedChunkIds, indexes.chunks, 'chunk'],
    ['citedEvidenceIds', citations.citedEvidenceIds, indexes.evidence, 'evidence'],
  ];
  let resolved = 0;
  let total = 0;
  for (const [field, ids, index, kind] of checks) {
    for (const id of ids) {
      total += 1;
      if (!index.has(id)) {
        push(GATE.CITATION_RESOLVABLE, `${item.id} ${field} ${id} is not a known ${kind} id`);
      } else {
        resolved += 1;
      }
    }
  }
  citations.resolvedCount = resolved;
  citations.totalCount = total;

  const expectedChecks = [
    ['expectedConceptIds', 'citedConceptIds', indexes.concepts, 'concept'],
    ['expectedSourceIds', 'citedSourceIds', indexes.sources, 'source'],
    ['expectedChunkIds', 'citedChunkIds', indexes.chunks, 'chunk'],
    ['expectedEvidenceIds', 'citedEvidenceIds', indexes.evidence, 'evidence'],
  ];
  if (shouldAnswer) {
    for (const [, citedField, , kind] of expectedChecks) {
      if (citations[citedField].length === 0) {
        push(GATE.CITATION_RESOLVABLE, `${item.id} answerable item must cite at least one ${kind}`);
      }
    }
  }
  for (const [expectedField, citedField, index, kind] of expectedChecks) {
    for (const expectedId of asIdList(item[expectedField])) {
      if (!index.has(expectedId)) {
        push(
          GATE.CITATION_RESOLVABLE,
          `${item.id} ${expectedField} ${expectedId} is not a known ${kind}`,
        );
      } else if (!citations[citedField].includes(expectedId)) {
        push(
          GATE.CITATION_RESOLVABLE,
          `${item.id} ${expectedField} ${expectedId} is missing from ${citedField}`,
        );
      }
    }
  }
}

function validateCitationGraph(item, citations, indexes, push) {
  for (const chunkId of citations.citedChunkIds) {
    const chunk = indexes.chunks.get(chunkId);
    if (!chunk) continue;
    if (!citations.citedSourceIds.includes(chunk.sourceId)) {
      push(
        GATE.GRAPH_CONNECTED,
        `${item.id} cited chunk ${chunkId} is not connected to cited source ${chunk.sourceId}`,
      );
    }
  }
  for (const evidenceId of citations.citedEvidenceIds) {
    const row = indexes.evidence.get(evidenceId);
    if (!row) continue;
    if (!citations.citedConceptIds.includes(row.conceptId)) {
      push(
        GATE.GRAPH_CONNECTED,
        `${item.id} cited evidence ${evidenceId} is not connected to cited concept ${row.conceptId}`,
      );
    }
    if (!citations.citedSourceIds.includes(row.sourceId)) {
      push(
        GATE.GRAPH_CONNECTED,
        `${item.id} cited evidence ${evidenceId} is not connected to cited source ${row.sourceId}`,
      );
    }
    if (row.chunkId && !citations.citedChunkIds.includes(row.chunkId)) {
      push(
        GATE.GRAPH_CONNECTED,
        `${item.id} cited evidence ${evidenceId} is not connected to cited chunk ${row.chunkId}`,
      );
    }
  }
  if (
    item.hop === 'multi-hop' &&
    citations.citedConceptIds.length > 1 &&
    !hasConnectedConceptSubgraph(citations.citedConceptIds, indexes)
  ) {
    push(
      GATE.GRAPH_CONNECTED,
      `${item.id} cited concepts are not connected by related[] or relation rows`,
    );
  }
}

function hasConnectedConceptSubgraph(conceptIds, indexes) {
  const cited = new Set(conceptIds);
  const adjacency = new Map(conceptIds.map((id) => [id, new Set()]));
  const connect = (left, right) => {
    if (!cited.has(left) || !cited.has(right)) return;
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };
  for (const conceptId of conceptIds) {
    const concept = indexes.concepts.get(conceptId);
    for (const relatedId of asIdList(concept?.related)) connect(conceptId, relatedId);
  }
  for (const relation of indexes.relations.values()) {
    connect(relation.sourceConceptId, relation.targetConceptId);
  }
  const visited = new Set();
  const pending = [conceptIds[0]];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) pending.push(next);
  }
  return visited.size === cited.size;
}

function validateUnknownCitations(item, citations, answer, shouldAnswer, hop, push) {
  const isUnknown = hop === 'unknown' || shouldAnswer === false;
  if (!isUnknown) return;
  const forged = [];
  for (const key of CITATION_KEYS) {
    if (citations[key].length > 0) forged.push(`${key}=${citations[key].join(',')}`);
  }
  if (typeof answer === 'string' && citationMarks(answer).length > 0) {
    forged.push('answer contains [CX] markers');
  }
  if (forged.length > 0) {
    push(
      GATE.UNKNOWN_WITHOUT_CITATION,
      `${item.id} unknown item must not forge citations (${forged.join('; ')})`,
    );
  }
}

function scanForbiddenText(doc, push) {
  const stack = [{ value: doc, path: '$' }];
  while (stack.length > 0) {
    const { value, path: valuePath } = stack.pop();
    if (typeof value === 'string') {
      if (FORBIDDEN_TEXT.test(value)) {
        push(GATE.PARSE_OR_RUN, `${valuePath} is not de-identified`);
      }
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => stack.push({ value: entry, path: `${valuePath}[${index}]` }));
      continue;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        stack.push({ value: child, path: `${valuePath}.${key}` });
      }
    }
  }
}

function rankConcepts(question, concepts, relations) {
  const queryTokens = tokenize(question);
  const scored = concepts
    .filter((concept) => concept?.id)
    .map((concept) => {
      const text = `${concept.title || ''} ${concept.summary || ''} ${concept.body || ''}`;
      return { id: concept.id, title: concept.title || '', score: overlap(queryTokens, text) };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const seedIds = new Set(scored.filter((row) => row.score > 0).map((row) => row.id));
  if (seedIds.size > 0) {
    for (const relation of relations) {
      if (seedIds.has(relation.sourceConceptId) && relation.targetConceptId) {
        seedIds.add(relation.targetConceptId);
      }
      if (seedIds.has(relation.targetConceptId) && relation.sourceConceptId) {
        seedIds.add(relation.sourceConceptId);
      }
    }
  }

  const byId = new Map(scored.map((row) => [row.id, row]));
  return [...seedIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .concat(scored.filter((row) => !seedIds.has(row.id)));
}

function scoreItem(item, answer, retrieved) {
  const expectedIds = asIdList(item.expectedConceptIds);
  const expectedTitles = asIdList(item.expectedConceptTitles);
  const hasHitExpectations = expectedIds.length > 0 || expectedTitles.length > 0;
  const rank = hasHitExpectations ? firstMatchRank(retrieved, expectedIds, expectedTitles) : 0;
  const expectedKeywords = asIdList(item.expectedKeywords);
  const lowerAnswer = String(answer || '').toLowerCase();
  const matched = expectedKeywords.filter((keyword) => lowerAnswer.includes(keyword.toLowerCase()));
  const hitAt = (k) => (rank > 0 && rank <= k ? 1 : 0);
  return {
    id: item.id,
    hop: item.hop,
    hitAt1: hasHitExpectations ? hitAt(1) : 0,
    hitAt3: hasHitExpectations ? hitAt(3) : 0,
    hitAt8: hasHitExpectations ? hitAt(8) : 0,
    mrr: hasHitExpectations && rank > 0 ? 1 / rank : 0,
    keywordRecall: expectedKeywords.length === 0 ? 0 : matched.length / expectedKeywords.length,
    hitSkipped: !hasHitExpectations,
    keywordSkipped: expectedKeywords.length === 0,
    citationResolved: 0,
    citationTotal: 0,
  };
}

function firstMatchRank(candidates, expectedIds, expectedTitles) {
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (expectedIds.includes(candidate.id)) return i + 1;
    const title = String(candidate.title || '').toLowerCase();
    if (expectedTitles.some((fragment) => title.includes(fragment.toLowerCase()))) return i + 1;
  }
  return 0;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function overlap(queryTokens, text) {
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(tokenize(text));
  return queryTokens.reduce((sum, token) => sum + (haystack.has(token) ? 1 : 0), 0);
}

function asIdList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((id) => typeof id === 'string' && id.length > 0);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function emptyItemScore(item) {
  return {
    id: item?.id || '(missing)',
    hop: item?.hop,
    hitAt1: 0,
    hitAt3: 0,
    hitAt8: 0,
    mrr: 0,
    keywordRecall: 0,
    hitSkipped: true,
    keywordSkipped: true,
    citationResolved: 0,
    citationTotal: 0,
  };
}

function aggregateReportOnly(itemScores) {
  const hitRows = itemScores.filter((row) => !row.hitSkipped);
  const kwRows = itemScores.filter((row) => !row.keywordSkipped);
  const avg = (rows, pick) =>
    rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  return {
    hitAt1: avg(hitRows, (row) => row.hitAt1),
    hitAt3: avg(hitRows, (row) => row.hitAt3),
    hitAt8: avg(hitRows, (row) => row.hitAt8),
    mrr: avg(hitRows, (row) => row.mrr),
    keywordRecall: avg(kwRows, (row) => row.keywordRecall),
    hitDenom: hitRows.length,
    keywordDenom: kwRows.length,
  };
}

function citationRate(itemScores) {
  const total = itemScores.reduce((sum, row) => sum + row.citationTotal, 0);
  const resolved = itemScores.reduce((sum, row) => sum + row.citationResolved, 0);
  return { total, resolved, rate: total === 0 ? 1 : resolved / total };
}

function failParseOrRun(message, options = {}) {
  return finalize([{ gate: GATE.PARSE_OR_RUN, message }], options);
}

function finalize(failures, options = {}, context = {}) {
  const itemScores = context.itemScores || [];
  const citations = citationRate(itemScores);
  const gates = {
    [GATE.PARSE_OR_RUN]: makeGate(GATE.PARSE_OR_RUN, failures, (rows) =>
      rows.length === 0 ? '0' : `${rows.length} error(s)`,
    ),
    [GATE.CITATION_RESOLVABLE]: makeGate(
      GATE.CITATION_RESOLVABLE,
      failures,
      () => `${(citations.rate * 100).toFixed(0)}% (${citations.resolved}/${citations.total})`,
    ),
    [GATE.GRAPH_CONNECTED]: makeGate(GATE.GRAPH_CONNECTED, failures, (rows) =>
      rows.length === 0 ? 'ok' : `${rows.length} break(s)`,
    ),
    [GATE.SSE_DONE_COMPLETE]: makeGate(GATE.SSE_DONE_COMPLETE, failures, (rows) =>
      rows.length === 0 ? 'ok' : `${rows.length} issue(s)`,
    ),
    [GATE.UNKNOWN_WITHOUT_CITATION]: makeGate(GATE.UNKNOWN_WITHOUT_CITATION, failures, (rows) =>
      rows.length === 0 ? 'ok' : `${rows.length} offender(s)`,
    ),
  };
  const ok = Object.values(gates).every((gate) => gate.pass);
  return {
    ok,
    exitCode: ok ? 0 : 1,
    corpusPath: options.corpusPath,
    itemCount: (context.items || []).length,
    hopCounts: context.hopCounts || { 'one-hop': 0, 'multi-hop': 0, unknown: 0 },
    entityCounts: {
      sources: (context.sources || []).length,
      concepts: (context.concepts || []).length,
      chunks: (context.chunks || []).length,
      evidence: (context.evidence || []).length,
      relations: (context.relations || []).length,
    },
    hardGates: gates,
    reportOnly: aggregateReportOnly(itemScores),
    failures,
    items: itemScores,
  };
}

function makeGate(id, failures, detailFn) {
  const rows = failures.filter((failure) => failure.gate === id);
  return {
    id,
    pass: rows.length === 0,
    count: rows.length,
    detail: detailFn(rows),
    messages: rows.map((row) => row.message),
  };
}

function formatHopCounts(hopCounts = {}) {
  return HOP_KINDS.map((kind) => `${kind}=${hopCounts[kind] || 0}`).join(', ');
}

function formatEntityCounts(counts = {}) {
  return `sources=${counts.sources || 0} concepts=${counts.concepts || 0} chunks=${counts.chunks || 0} evidence=${counts.evidence || 0} relations=${counts.relations || 0}`;
}
