#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_DIR = process.env.DATA_DIR?.trim()
  ? path.resolve(process.env.DATA_DIR.trim())
  : DEFAULT_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, 'compound.db');

function usage() {
  console.log(`Usage:
  node scripts/wiki-integrity.mjs --dry-run
  node scripts/wiki-integrity.mjs --apply

Options:
  --dry-run   Print orphan counts and example IDs without deleting anything.
  --apply     Delete orphan evidence, relations, and chunk embeddings in one transaction.`);
}

function parseMode() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) return 'help';
  if (args.has('--dry-run') && args.has('--apply')) {
    throw new Error('Use either --dry-run or --apply, not both.');
  }
  if (args.has('--apply')) return 'apply';
  return 'dry-run';
}

function tableExists(db, tableName) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  return Boolean(row?.name);
}

function countWithExamples(db, countSql, examplesSql) {
  const count = Number(db.prepare(countSql).get()?.count ?? 0);
  const examples = db
    .prepare(examplesSql)
    .all()
    .map((row) => String(row.id))
    .filter(Boolean);
  return { count, examples };
}

function collectIntegrity(db) {
  const orphanEvidence = countWithExamples(
    db,
    `
      SELECT COUNT(*) AS count
      FROM concept_evidence ev
      LEFT JOIN concepts c ON c.id = ev.concept_id
      LEFT JOIN sources s ON s.id = ev.source_id
      LEFT JOIN source_chunks ch ON ch.id = ev.chunk_id
      WHERE c.id IS NULL
         OR s.id IS NULL
         OR (ev.chunk_id IS NOT NULL AND ch.id IS NULL)
    `,
    `
      SELECT ev.id
      FROM concept_evidence ev
      LEFT JOIN concepts c ON c.id = ev.concept_id
      LEFT JOIN sources s ON s.id = ev.source_id
      LEFT JOIN source_chunks ch ON ch.id = ev.chunk_id
      WHERE c.id IS NULL
         OR s.id IS NULL
         OR (ev.chunk_id IS NOT NULL AND ch.id IS NULL)
      ORDER BY ev.created_at DESC
      LIMIT 10
    `,
  );

  const orphanRelations = countWithExamples(
    db,
    `
      SELECT COUNT(*) AS count
      FROM concept_relations rel
      LEFT JOIN concepts source ON source.id = rel.source_concept_id
      LEFT JOIN concepts target ON target.id = rel.target_concept_id
      WHERE source.id IS NULL OR target.id IS NULL
    `,
    `
      SELECT rel.id
      FROM concept_relations rel
      LEFT JOIN concepts source ON source.id = rel.source_concept_id
      LEFT JOIN concepts target ON target.id = rel.target_concept_id
      WHERE source.id IS NULL OR target.id IS NULL
      ORDER BY rel.updated_at DESC
      LIMIT 10
    `,
  );

  const orphanChunkEmbeddings = tableExists(db, 'chunk_embeddings')
    ? countWithExamples(
        db,
        `
          SELECT COUNT(*) AS count
          FROM chunk_embeddings emb
          LEFT JOIN source_chunks ch ON ch.id = emb.chunk_id
          LEFT JOIN sources s ON s.id = emb.source_id
          WHERE ch.id IS NULL OR s.id IS NULL
        `,
        `
          SELECT emb.chunk_id AS id
          FROM chunk_embeddings emb
          LEFT JOIN source_chunks ch ON ch.id = emb.chunk_id
          LEFT JOIN sources s ON s.id = emb.source_id
          WHERE ch.id IS NULL OR s.id IS NULL
          ORDER BY emb.updated_at DESC
          LIMIT 10
        `,
      )
    : { count: 0, examples: [] };

  return { orphanEvidence, orphanRelations, orphanChunkEmbeddings };
}

function printIntegrity(integrity) {
  for (const [key, value] of Object.entries(integrity)) {
    const sample = value.examples.length > 0 ? value.examples.join(', ') : 'none';
    console.log(`${key}: ${value.count} (examples: ${sample})`);
  }
}

function cleanup(db) {
  const deleteOrphans = db.transaction(() => {
    const evidence = db
      .prepare(
        `
          DELETE FROM concept_evidence
          WHERE id IN (
            SELECT ev.id
            FROM concept_evidence ev
            LEFT JOIN concepts c ON c.id = ev.concept_id
            LEFT JOIN sources s ON s.id = ev.source_id
            LEFT JOIN source_chunks ch ON ch.id = ev.chunk_id
            WHERE c.id IS NULL
               OR s.id IS NULL
               OR (ev.chunk_id IS NOT NULL AND ch.id IS NULL)
          )
        `,
      )
      .run().changes;

    const relations = db
      .prepare(
        `
          DELETE FROM concept_relations
          WHERE id IN (
            SELECT rel.id
            FROM concept_relations rel
            LEFT JOIN concepts source ON source.id = rel.source_concept_id
            LEFT JOIN concepts target ON target.id = rel.target_concept_id
            WHERE source.id IS NULL OR target.id IS NULL
          )
        `,
      )
      .run().changes;

    const chunkEmbeddings = tableExists(db, 'chunk_embeddings')
      ? db
          .prepare(
            `
              DELETE FROM chunk_embeddings
              WHERE chunk_id IN (
                SELECT emb.chunk_id
                FROM chunk_embeddings emb
                LEFT JOIN source_chunks ch ON ch.id = emb.chunk_id
                LEFT JOIN sources s ON s.id = emb.source_id
                WHERE ch.id IS NULL OR s.id IS NULL
              )
            `,
          )
          .run().changes
      : 0;

    return { evidence, relations, chunkEmbeddings };
  });

  return deleteOrphans();
}

function main() {
  const mode = parseMode();
  if (mode === 'help') {
    usage();
    return;
  }

  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  try {
    console.log(`database: ${DB_PATH}`);
    const before = collectIntegrity(db);
    printIntegrity(before);
    if (mode === 'dry-run') return;

    const deleted = cleanup(db);
    console.log(
      `deleted: evidence=${deleted.evidence}, relations=${deleted.relations}, chunkEmbeddings=${deleted.chunkEmbeddings}`,
    );
    const after = collectIntegrity(db);
    printIntegrity(after);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
