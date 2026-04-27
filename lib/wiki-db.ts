import { nanoid } from 'nanoid';
import { getServerDb, repo } from './server-db';
import { splitMarkdownIntoChunks, type SourceChunkDraft } from './wiki-chunk';
import type { Concept, Source } from './types';

export type EvidenceKind =
  | 'definition'
  | 'claim'
  | 'example'
  | 'quote'
  | 'contradiction'
  | 'support';
export type RelationKind =
  | 'supports'
  | 'contradicts'
  | 'extends'
  | 'example_of'
  | 'depends_on'
  | 'similar_to'
  | 'contrasts_with'
  | 'related';

export interface SourceChunk extends SourceChunkDraft {
  id: string;
  sourceId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConceptEvidence {
  id: string;
  conceptId: string;
  sourceId: string;
  chunkId?: string;
  quote?: string;
  claim: string;
  kind: EvidenceKind;
  confidence: number;
  createdAt: number;
}

export interface QueryContext {
  concepts: Concept[];
  chunks: SourceChunk[];
  evidence: ConceptEvidence[];
}

let migrationsReady = false;
let ftsReady: boolean | null = null;

function json<T>(value: T): string {
  return JSON.stringify(value ?? null);
}

function parseJsonArray<T>(value: string | null | undefined, fallback: T[] = []): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function extractSearchTerms(text: string, limit = 12): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  ).slice(0, limit);
}

function toFtsQuery(text: string): string {
  const terms = extractSearchTerms(text, 10).map((term) => term.replace(/"/g, ''));
  return terms.map((term) => `"${term}"`).join(' OR ');
}

function hasFts(): boolean {
  ensureWikiCompilerSchema();
  return Boolean(ftsReady);
}

function safeRunFts(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    ftsReady = false;
    console.warn('[wiki-db] FTS disabled:', error instanceof Error ? error.message : String(error));
  }
}

function termsFromConcept(concept: Concept): string[] {
  return Array.from(
    new Set(
      `${concept.title}\n${concept.summary}`
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff]+/i)
        .map((part) => part.trim())
        .filter((part) => part.length >= 2),
    ),
  ).slice(0, 12);
}

function scoreChunkText(content: string, terms: string[]): number {
  const haystack = content.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function quoteFromChunk(content: string): string {
  return content
    .replace(/^路径：.+?\n\n/s, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

function buildEvidenceDrafts(
  source: Source,
  concept: Concept,
  chunks: SourceChunk[],
): Array<Omit<ConceptEvidence, 'id' | 'createdAt'>> {
  const terms = termsFromConcept(concept);
  const ranked = chunks
    .map((chunk) => ({ chunk, score: scoreChunkText(chunk.content, terms) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((item) => item.score > 0 || chunks.length <= 3);

  return ranked.map(({ chunk, score }) => ({
    conceptId: concept.id,
    sourceId: source.id,
    chunkId: chunk.id,
    quote: quoteFromChunk(chunk.content),
    claim: concept.summary || `「${concept.title}」由资料「${source.title}」提供支撑。`,
    kind: 'support',
    confidence: score > 0 ? Math.min(0.95, 0.55 + score * 0.08) : 0.42,
  }));
}

export function ensureWikiCompilerSchema(): void {
  if (migrationsReady) return;
  const db = getServerDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS source_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      heading TEXT NOT NULL,
      heading_path TEXT NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_chunks_source_index ON source_chunks(source_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_source_chunks_source ON source_chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_source_chunks_hash ON source_chunks(content_hash);

    CREATE TABLE IF NOT EXISTS concept_evidence (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      chunk_id TEXT,
      quote TEXT,
      claim TEXT NOT NULL,
      kind TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concept_evidence_concept ON concept_evidence(concept_id);
    CREATE INDEX IF NOT EXISTS idx_concept_evidence_source ON concept_evidence(source_id);
    CREATE INDEX IF NOT EXISTS idx_concept_evidence_chunk ON concept_evidence(chunk_id);

    CREATE TABLE IF NOT EXISTS concept_relations (
      id TEXT PRIMARY KEY,
      source_concept_id TEXT NOT NULL,
      target_concept_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      reason TEXT,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_relations_pair_kind
      ON concept_relations(source_concept_id, target_concept_id, kind);
    CREATE INDEX IF NOT EXISTS idx_concept_relations_source ON concept_relations(source_concept_id);
    CREATE INDEX IF NOT EXISTS idx_concept_relations_target ON concept_relations(target_concept_id);

    CREATE TABLE IF NOT EXISTS concept_versions (
      id TEXT PRIMARY KEY,
      concept_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      previous_body TEXT,
      next_body TEXT NOT NULL,
      source_ids TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concept_versions_concept ON concept_versions(concept_id, version DESC);

    CREATE TABLE IF NOT EXISTS model_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT,
      provider TEXT,
      model TEXT NOT NULL,
      task TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      cost_usd REAL,
      prompt_hash TEXT,
      output_hash TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_model_runs_task ON model_runs(task, created_at DESC);
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS concept_fts USING fts5(
        concept_id UNINDEXED,
        title,
        summary,
        body,
        tokenize='unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
        chunk_id UNINDEXED,
        source_id UNINDEXED,
        heading,
        content,
        tokenize='unicode61'
      );
    `);
    ftsReady = true;
  } catch (error) {
    ftsReady = false;
    console.warn(
      '[wiki-db] FTS5 unavailable; falling back to LIKE search:',
      error instanceof Error ? error.message : String(error),
    );
  }

  migrationsReady = true;
}

function rowToChunk(row: Record<string, unknown>): SourceChunk {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    chunkIndex: Number(row.chunk_index),
    heading: String(row.heading),
    headingPath: parseJsonArray<string>(row.heading_path as string),
    content: String(row.content),
    tokenCount: Number(row.token_count),
    contentHash: String(row.content_hash),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToEvidence(row: Record<string, unknown>): ConceptEvidence {
  return {
    id: String(row.id),
    conceptId: String(row.concept_id),
    sourceId: String(row.source_id),
    chunkId: row.chunk_id ? String(row.chunk_id) : undefined,
    quote: row.quote ? String(row.quote) : undefined,
    claim: String(row.claim),
    kind: row.kind as EvidenceKind,
    confidence: Number(row.confidence),
    createdAt: Number(row.created_at),
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export const wikiRepo = {
  ensureSchema: ensureWikiCompilerSchema,

  deleteSourceArtifacts(sourceId: string): void {
    ensureWikiCompilerSchema();
    const db = getServerDb();
    db.prepare(`DELETE FROM concept_evidence WHERE source_id = ?`).run(sourceId);
    db.prepare(`DELETE FROM source_chunks WHERE source_id = ?`).run(sourceId);
    if (hasFts()) {
      safeRunFts(() => db.prepare(`DELETE FROM chunk_fts WHERE source_id = ?`).run(sourceId));
    }
  },

  upsertSourceChunks(
    sourceId: string,
    drafts: SourceChunkDraft[],
    now = Date.now(),
  ): SourceChunk[] {
    ensureWikiCompilerSchema();
    this.deleteSourceArtifacts(sourceId);
    const db = getServerDb();
    const rows: SourceChunk[] = drafts.map((draft) => ({
      ...draft,
      id: `ch-${nanoid(10)}`,
      sourceId,
      createdAt: now,
      updatedAt: now,
    }));

    const insert = db.prepare(`
      INSERT INTO source_chunks
        (id, source_id, chunk_index, heading, heading_path, content, token_count, content_hash, created_at, updated_at)
      VALUES
        (@id, @source_id, @chunk_index, @heading, @heading_path, @content, @token_count, @content_hash, @created_at, @updated_at)
    `);
    const insertFts = hasFts()
      ? db.prepare(
          `INSERT INTO chunk_fts (chunk_id, source_id, heading, content) VALUES (?, ?, ?, ?)`,
        )
      : null;

    const runBatch = db.transaction((batch: SourceChunk[]) => {
      for (const row of batch) {
        insert.run({
          id: row.id,
          source_id: row.sourceId,
          chunk_index: row.chunkIndex,
          heading: row.heading,
          heading_path: json(row.headingPath),
          content: row.content,
          token_count: row.tokenCount,
          content_hash: row.contentHash,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
        });
        insertFts?.run(row.id, row.sourceId, row.heading, row.content);
      }
    });
    runBatch(rows);

    return rows;
  },

  indexSource(source: Source): SourceChunk[] {
    const chunks = splitMarkdownIntoChunks(source.rawContent, {
      maxTokens: Number(process.env.COMPOUND_CHUNK_MAX_TOKENS || 1200),
      overlapTokens: Number(process.env.COMPOUND_CHUNK_OVERLAP_TOKENS || 120),
    });
    return this.upsertSourceChunks(source.id, chunks, Date.now());
  },

  indexConcept(concept: Concept): void {
    ensureWikiCompilerSchema();
    if (!hasFts()) return;
    const db = getServerDb();
    safeRunFts(() => {
      db.prepare(`DELETE FROM concept_fts WHERE concept_id = ?`).run(concept.id);
      db.prepare(
        `INSERT INTO concept_fts (concept_id, title, summary, body) VALUES (?, ?, ?, ?)`,
      ).run(concept.id, concept.title, concept.summary, concept.body);
    });
  },

  rebuildAllIndexes(): {
    sources: number;
    chunks: number;
    concepts: number;
    evidence: number;
    fts: boolean;
  } {
    ensureWikiCompilerSchema();
    const db = getServerDb();

    const wipe = db.transaction(() => {
      db.prepare(`DELETE FROM source_chunks`).run();
      db.prepare(`DELETE FROM concept_evidence`).run();
      if (hasFts()) {
        safeRunFts(() => {
          db.prepare(`DELETE FROM concept_fts`).run();
          db.prepare(`DELETE FROM chunk_fts`).run();
        });
      }
    });
    wipe();

    const concepts = repo.listConcepts({ summariesOnly: false });
    const sources = repo.listSources({ summariesOnly: false });
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const chunksBySourceId = new Map<string, SourceChunk[]>();

    let chunkCount = 0;
    for (const source of sources) {
      const chunks = this.indexSource(source);
      chunksBySourceId.set(source.id, chunks);
      chunkCount += chunks.length;
    }

    let evidenceCount = 0;
    for (const concept of concepts) {
      this.indexConcept(concept);
      for (const sourceId of concept.sources) {
        const source = sourceMap.get(sourceId);
        const chunks = chunksBySourceId.get(sourceId);
        if (!source || !chunks || chunks.length === 0) continue;
        const evidence = buildEvidenceDrafts(source, concept, chunks);
        this.addEvidenceBatch(evidence);
        evidenceCount += evidence.length;
      }
    }

    return {
      sources: sources.length,
      chunks: chunkCount,
      concepts: concepts.length,
      evidence: evidenceCount,
      fts: hasFts(),
    };
  },

  addEvidenceBatch(items: Array<Omit<ConceptEvidence, 'id' | 'createdAt'>>): void {
    ensureWikiCompilerSchema();
    if (items.length === 0) return;
    const db = getServerDb();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO concept_evidence
        (id, concept_id, source_id, chunk_id, quote, claim, kind, confidence, created_at)
      VALUES
        (@id, @concept_id, @source_id, @chunk_id, @quote, @claim, @kind, @confidence, @created_at)
    `);
    const now = Date.now();
    const runBatch = db.transaction(() => {
      for (const item of items) {
        insert.run({
          id: `ev-${nanoid(10)}`,
          concept_id: item.conceptId,
          source_id: item.sourceId,
          chunk_id: item.chunkId ?? null,
          quote: item.quote ?? null,
          claim: item.claim,
          kind: item.kind,
          confidence: item.confidence,
          created_at: now,
        });
      }
    });
    runBatch();
  },

  recordConceptVersion(input: {
    conceptId: string;
    version: number;
    previousBody?: string;
    nextBody: string;
    sourceIds: string[];
    changeSummary: string;
  }): void {
    ensureWikiCompilerSchema();
    getServerDb()
      .prepare(
        `
        INSERT INTO concept_versions
          (id, concept_id, version, previous_body, next_body, source_ids, change_summary, created_at)
        VALUES
          (@id, @concept_id, @version, @previous_body, @next_body, @source_ids, @change_summary, @created_at)
      `,
      )
      .run({
        id: `cv-${nanoid(10)}`,
        concept_id: input.conceptId,
        version: input.version,
        previous_body: input.previousBody ?? null,
        next_body: input.nextBody,
        source_ids: json(input.sourceIds),
        change_summary: input.changeSummary,
        created_at: Date.now(),
      });
  },

  searchConcepts(query: string, limit = 24): Concept[] {
    ensureWikiCompilerSchema();
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery && hasFts()) {
      try {
        const rows = getServerDb()
          .prepare(
            `SELECT concept_id FROM concept_fts WHERE concept_fts MATCH ? ORDER BY bm25(concept_fts) LIMIT ?`,
          )
          .all(ftsQuery, normalizedLimit) as Array<{ concept_id: string }>;
        const concepts = repo.getConceptsByIds(rows.map((row) => row.concept_id));
        if (concepts.length > 0) return concepts;
      } catch (error) {
        console.warn(
          '[wiki-db] concept FTS search failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return repo.findConceptCandidates(query, normalizedLimit).slice(0, normalizedLimit);
  },

  searchChunks(query: string, limit = 12): SourceChunk[] {
    ensureWikiCompilerSchema();
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery && hasFts()) {
      try {
        const rows = getServerDb()
          .prepare(
            `
            SELECT source_chunks.*
            FROM chunk_fts
            JOIN source_chunks ON source_chunks.id = chunk_fts.chunk_id
            WHERE chunk_fts MATCH ?
            ORDER BY bm25(chunk_fts)
            LIMIT ?
          `,
          )
          .all(ftsQuery, normalizedLimit) as Array<Record<string, unknown>>;
        if (rows.length > 0) return rows.map(rowToChunk);
      } catch (error) {
        console.warn(
          '[wiki-db] chunk FTS search failed:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    const terms = extractSearchTerms(query, 8);
    if (terms.length === 0) return [];

    // SQL-level pre-filter with LIKE on heading + substr(content) to avoid
    // loading full content of 500 rows into JS memory.
    const likeClauses = terms.map(
      () => `(heading LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)`,
    );
    const likeParams = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);
    const rows = getServerDb()
      .prepare(
        `SELECT id, source_id, chunk_index, heading, heading_path,
                substr(content, 1, 500) AS content, token_count, content_hash,
                created_at, updated_at
         FROM source_chunks
         WHERE ${likeClauses.join(' OR ')}
         ORDER BY updated_at DESC
         LIMIT 100`,
      )
      .all(...likeParams) as Array<Record<string, unknown>>;
    return rows
      .map((row) => ({ row, score: scoreChunkText(`${row.heading}\n${row.content}`, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, normalizedLimit)
      .map((item) => rowToChunk(item.row));
  },

  getEvidenceForConcepts(conceptIds: string[], limitPerConcept = 3): ConceptEvidence[] {
    ensureWikiCompilerSchema();
    const uniqueIds = Array.from(new Set(conceptIds.filter(Boolean)));
    if (uniqueIds.length === 0) return [];
    const out: ConceptEvidence[] = [];
    const stmt = getServerDb().prepare(`
      SELECT * FROM concept_evidence
      WHERE concept_id = ?
      ORDER BY confidence DESC, created_at DESC
      LIMIT ?
    `);
    for (const id of uniqueIds) {
      out.push(
        ...(stmt.all(id, limitPerConcept) as Array<Record<string, unknown>>).map(rowToEvidence),
      );
    }
    return out;
  },

  searchWikiContext(
    query: string,
    options: { conceptLimit?: number; chunkLimit?: number } = {},
  ): QueryContext {
    const concepts = this.searchConcepts(query, options.conceptLimit ?? 24);
    const chunks = this.searchChunks(query, options.chunkLimit ?? 12);
    const evidence = this.getEvidenceForConcepts(
      concepts.map((concept) => concept.id),
      2,
    );
    return {
      concepts: uniqueById(concepts),
      chunks: uniqueById(chunks),
      evidence: uniqueById(evidence),
    };
  },

  getMetrics(): Record<string, number | boolean> {
    ensureWikiCompilerSchema();
    const db = getServerDb();
    const scalar = (sql: string) =>
      Number((db.prepare(sql).get() as { count?: number } | undefined)?.count ?? 0);
    return {
      ftsReady: hasFts(),
      sources: scalar(`SELECT COUNT(*) AS count FROM sources`),
      concepts: scalar(`SELECT COUNT(*) AS count FROM concepts`),
      sourceChunks: scalar(`SELECT COUNT(*) AS count FROM source_chunks`),
      conceptEvidence: scalar(`SELECT COUNT(*) AS count FROM concept_evidence`),
      conceptVersions: scalar(`SELECT COUNT(*) AS count FROM concept_versions`),
    };
  },
};

export function formatQueryContextForPrompt(context: QueryContext): string {
  const concepts = context.concepts
    .map((concept) => {
      const body = (concept.body || '').slice(0, 1200);
      return `## [${concept.id}] ${concept.title}\n_${concept.summary}_\n\n${body}`;
    })
    .join('\n\n---\n\n');

  const evidence = context.evidence
    .slice(0, 16)
    .map((item, index) => {
      const quote = item.quote ? `\n摘录：${item.quote.slice(0, 360)}` : '';
      return `${index + 1}. concept=${item.conceptId} source=${item.sourceId} kind=${item.kind}\n主张：${item.claim}${quote}`;
    })
    .join('\n\n');

  const chunks = context.chunks
    .slice(0, 8)
    .map(
      (chunk, index) =>
        `${index + 1}. source=${chunk.sourceId} chunk=${chunk.id} heading=${chunk.heading}\n${chunk.content.slice(0, 700)}`,
    )
    .join('\n\n');

  return [
    concepts ? `# 相关概念页\n\n${concepts}` : '',
    evidence ? `# 证据链\n\n${evidence}` : '',
    chunks ? `# 原文片段候选\n\n${chunks}` : '',
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}
