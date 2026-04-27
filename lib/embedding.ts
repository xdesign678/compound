/**
 * Embedding + hybrid search.
 *
 * No external vector DB is required. Remote embeddings are used when configured;
 * otherwise a deterministic local hashing embedding is used so the pipeline still
 * works in local/dev environments.
 */
import { getServerDb } from './server-db';
import { wikiRepo, type QueryContext, type SourceChunk } from './wiki-db';

type Vector = number[];

let schemaReady = false;

function now(): number {
  return Date.now();
}

function ensureEmbeddingSchema(): void {
  if (schemaReady) return;
  wikiRepo.ensureSchema();
  getServerDb().exec(`
    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_source ON chunk_embeddings(source_id);
    CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model, updated_at DESC);
  `);
  schemaReady = true;
}

function clean(value?: string): string {
  return value?.replace(/^["'\s]+|["'\s]+$/g, '') || '';
}

function embeddingModel(): string {
  return clean(process.env.COMPOUND_EMBEDDING_MODEL) || 'text-embedding-3-small';
}

function embeddingApiKey(): string {
  return (
    clean(process.env.COMPOUND_EMBEDDING_API_KEY) ||
    clean(process.env.LLM_API_KEY) ||
    clean(process.env.AI_GATEWAY_API_KEY)
  );
}

function embeddingApiUrl(): string {
  const explicit = clean(process.env.COMPOUND_EMBEDDING_API_URL);
  if (explicit) return explicit;
  const chatUrl = clean(process.env.LLM_API_URL);
  if (chatUrl.includes('/chat/completions'))
    return chatUrl.replace('/chat/completions', '/embeddings');
  return 'https://api.openai.com/v1/embeddings';
}

function assertPublicHttps(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Embedding API URL must be HTTPS');
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    throw new Error('Embedding API URL must not target localhost');
  }
}

function hashToken(token: string): number {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalize(vec: Vector): Vector {
  const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

function localEmbedding(
  text: string,
  dims = Number(process.env.COMPOUND_LOCAL_EMBEDDING_DIMS || 256),
): Vector {
  const v = new Array(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const h = hashToken(token);
    const index = h % dims;
    const sign = h & 1 ? 1 : -1;
    v[index] += sign * Math.min(3, Math.sqrt(token.length));
  }
  return normalize(v);
}

async function remoteEmbeddings(texts: string[]): Promise<Vector[] | null> {
  const explicitEmbeddingConfig =
    Boolean(clean(process.env.COMPOUND_EMBEDDING_API_KEY)) ||
    Boolean(clean(process.env.COMPOUND_EMBEDDING_API_URL)) ||
    process.env.COMPOUND_EMBEDDING_PROVIDER === 'remote';
  if (!explicitEmbeddingConfig || process.env.COMPOUND_EMBEDDING_PROVIDER === 'local') {
    return null;
  }

  const key = embeddingApiKey();
  if (!key) return null;

  const url = embeddingApiUrl();
  assertPublicHttps(url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: embeddingModel(),
      input: texts.map((text) =>
        text.slice(0, Number(process.env.COMPOUND_EMBEDDING_MAX_CHARS || 8000)),
      ),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Embedding ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const vectors = data?.data?.map((item: { embedding?: number[] }) => item.embedding) as
    | number[][]
    | undefined;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error('Unexpected embedding response shape');
  }
  return vectors.map((v) => normalize(v));
}

async function embedTexts(
  texts: string[],
): Promise<{ vectors: Vector[]; provider: string; model: string }> {
  const remote = await remoteEmbeddings(texts);
  if (remote) return { vectors: remote, provider: 'remote', model: embeddingModel() };
  return {
    vectors: texts.map((text) => localEmbedding(text)),
    provider: 'local',
    model: `local-hash-${Number(process.env.COMPOUND_LOCAL_EMBEDDING_DIMS || 256)}`,
  };
}

function rowToChunk(row: Record<string, unknown>): SourceChunk {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    chunkIndex: Number(row.chunk_index),
    heading: String(row.heading),
    headingPath: JSON.parse(String(row.heading_path || '[]')) as string[],
    content: String(row.content),
    tokenCount: Number(row.token_count),
    contentHash: String(row.content_hash),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function cosine(a: Vector, b: Vector): number {
  const n = Math.min(a.length, b.length);
  let score = 0;
  for (let i = 0; i < n; i += 1) score += a[i] * b[i];
  return score;
}

export async function embedSourceChunks(
  sourceId: string,
): Promise<{ total: number; embedded: number; provider: string; model: string }> {
  ensureEmbeddingSchema();
  const chunks = getServerDb()
    .prepare(`SELECT * FROM source_chunks WHERE source_id = ? ORDER BY chunk_index ASC`)
    .all(sourceId) as Array<Record<string, unknown>>;
  if (chunks.length === 0) return { total: 0, embedded: 0, provider: 'none', model: 'none' };

  const batchSize = Math.max(1, Number(process.env.COMPOUND_EMBEDDING_BATCH_SIZE || 24));
  let embedded = 0;
  let provider = 'none';
  let model = 'none';
  const stmt = getServerDb().prepare(`
    INSERT OR REPLACE INTO chunk_embeddings
      (chunk_id, source_id, model, provider, dimensions, vector_json, content_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map((chunk) => `${chunk.heading}\n${chunk.content}`);
    const result = await embedTexts(texts);
    provider = result.provider;
    model = result.model;
    const ts = now();
    const trx = getServerDb().transaction(() => {
      for (let j = 0; j < batch.length; j += 1) {
        const chunk = batch[j];
        const vector = result.vectors[j];
        stmt.run(
          String(chunk.id),
          String(chunk.source_id),
          model,
          provider,
          vector.length,
          JSON.stringify(vector),
          String(chunk.content_hash),
          ts,
          ts,
        );
      }
    });
    trx();
    embedded += batch.length;
  }
  return { total: chunks.length, embedded, provider, model };
}

/**
 * Use chunk_fts to get candidate chunk IDs for pre-filtering the vector scan.
 * Returns an empty array when FTS is unavailable or the query yields no terms.
 */
function getFtsChunkIds(query: string, limit: number): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (terms.length === 0) return [];
  const ftsExpr = Array.from(new Set(terms))
    .slice(0, 10)
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(' OR ');
  if (!ftsExpr) return [];
  try {
    const rows = getServerDb()
      .prepare(`SELECT chunk_id FROM chunk_fts WHERE chunk_fts MATCH ? LIMIT ?`)
      .all(ftsExpr, limit) as Array<{ chunk_id: string }>;
    return rows.map((r) => r.chunk_id);
  } catch {
    // chunk_fts table missing or FTS5 unavailable
    return [];
  }
}

export async function hybridSearchWikiContext(
  query: string,
  options: { conceptLimit?: number; chunkLimit?: number } = {},
): Promise<QueryContext> {
  ensureEmbeddingSchema();
  const conceptLimit =
    options.conceptLimit ?? Number(process.env.COMPOUND_QUERY_CONTEXT_CONCEPT_LIMIT || 24);
  const chunkLimit =
    options.chunkLimit ?? Number(process.env.COMPOUND_QUERY_CONTEXT_CHUNK_LIMIT || 12);

  const base = wikiRepo.searchWikiContext(query, { conceptLimit, chunkLimit });

  // --- FTS pre-filter: narrow vector scan to relevant chunks ---
  const ftsChunkIds = getFtsChunkIds(query, 200);
  const baseChunkIds = base.chunks.map((chunk) => chunk.id);
  // Merge base chunk IDs (already FTS-ranked) with additional FTS candidates
  const candidateIds = Array.from(new Set([...baseChunkIds, ...ftsChunkIds]));

  let vectorRows: Array<Record<string, unknown>>;

  if (candidateIds.length > 0) {
    // Targeted vector lookup – only load embeddings for FTS-matched chunks
    const placeholders = candidateIds.map(() => '?').join(',');
    vectorRows = getServerDb()
      .prepare(
        `SELECT ce.vector_json, sc.*
         FROM chunk_embeddings ce
         JOIN source_chunks sc ON sc.id = ce.chunk_id
         WHERE ce.chunk_id IN (${placeholders})`,
      )
      .all(...candidateIds) as Array<Record<string, unknown>>;
  } else {
    // No FTS results – fallback to a reduced full scan
    vectorRows = getServerDb()
      .prepare(
        `SELECT ce.vector_json, sc.*
         FROM chunk_embeddings ce
         JOIN source_chunks sc ON sc.id = ce.chunk_id
         ORDER BY ce.updated_at DESC
         LIMIT ?`,
      )
      .all(Number(process.env.COMPOUND_HYBRID_VECTOR_SCAN_LIMIT || 2000)) as Array<
      Record<string, unknown>
    >;
  }

  if (vectorRows.length === 0) return base;

  const queryVec = (await embedTexts([query])).vectors[0];
  const ftsIdSet = new Set(base.chunks.map((chunk) => chunk.id));
  const ranked = vectorRows
    .map((row) => {
      const chunk = rowToChunk(row);
      const vector = JSON.parse(String(row.vector_json || '[]')) as number[];
      const vectorScore = cosine(queryVec, vector);
      const ftsBoost = ftsIdSet.has(chunk.id) ? 0.25 : 0;
      return { chunk, score: vectorScore + ftsBoost };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, chunkLimit)
    .map((item) => item.chunk);

  const chunkMap = new Map<string, SourceChunk>();
  for (const chunk of [...base.chunks, ...ranked]) chunkMap.set(chunk.id, chunk);

  return {
    concepts: base.concepts,
    evidence: base.evidence,
    chunks: Array.from(chunkMap.values()).slice(0, chunkLimit),
  };
}

export function getEmbeddingMetrics(): Record<string, number | string> {
  ensureEmbeddingSchema();
  const scalar = (sql: string) =>
    Number((getServerDb().prepare(sql).get() as { count?: number } | undefined)?.count ?? 0);
  const row = getServerDb()
    .prepare(`SELECT provider, model FROM chunk_embeddings ORDER BY updated_at DESC LIMIT 1`)
    .get() as { provider?: string; model?: string } | undefined;
  return {
    chunkEmbeddings: scalar(`SELECT COUNT(*) AS count FROM chunk_embeddings`),
    embeddingSources: scalar(`SELECT COUNT(DISTINCT source_id) AS count FROM chunk_embeddings`),
    embeddingProvider: row?.provider || 'none',
    embeddingModel: row?.model || 'none',
  };
}
