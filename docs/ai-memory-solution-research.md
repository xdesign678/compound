# AI Long-Term Memory Solutions Research

Date: 2026-05-08

This note consolidates the user's original comparison of GBrain, GraphRAG,
Graphify, and LLM Wiki with follow-up repository research and the resulting
Compound-specific upgrade direction.

## Executive Summary

Compound should not replace its architecture with any single external memory
framework. The best fit is:

- LLM Wiki as the product model: durable, human-readable knowledge pages.
- GraphRAG-lite as the retrieval model: typed concept relations, evidence, and
  lightweight topic/community summaries.
- GBrain-style separation as an operational principle: persistent knowledge is
  separate from runtime/ops state.
- Graphify-style code maps as a developer aid, not a runtime dependency.

This means Compound's direction is a hybrid: a private LLM-maintained Wiki with
SQLite-backed provenance, graph edges, review gates, and exportable Markdown.

## Source Snapshot

These sources were checked during the research pass. Star counts are volatile
and should be treated only as rough popularity signals.

| Solution           | Checked source                                                      | Research note                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GBrain             | <https://github.com/garrytan/gbrain>                                | GitHub describes it as "Garry's Opinionated OpenClaw/Hermes Agent Brain"; roughly 13.6k stars when checked.                                                                                                |
| Microsoft GraphRAG | <https://github.com/microsoft/graphrag>                             | A modular graph-based RAG system; README frames it as an LLM-powered pipeline for extracting structured data from unstructured text and warns indexing can be expensive. Roughly 32.8k stars when checked. |
| Graphify           | <https://github.com/safishamsi/graphify>                            | GitHub describes it as an AI coding assistant skill that turns project folders into queryable knowledge graphs. Roughly 44.2k stars when checked.                                                          |
| LLM Wiki           | <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f> | A pattern document for personal knowledge bases using LLMs. The core idea is plain Markdown in Git, shaped by an agent rather than hidden behind a database-only retrieval layer.                          |

## Four Approaches

### GBrain

Positioning: long-term brain for a running AI agent.

Useful ideas:

- Separate persistent world knowledge from transient agent working state.
- Keep operational state such as tasks, progress, and run history available to
  the agent.
- Treat memory as part of an agent runtime, not only as a search index.

Limitations for Compound:

- It is opinionated around an agent ecosystem rather than a general knowledge
  product.
- Compound already has a better local fit: `concepts`, `sources`,
  `analysis_jobs`, `model_runs`, review queue, and sync observability.

Compound takeaway:

- Do not adopt GBrain as a dependency.
- Borrow the separation between "knowledge memory" and "operations memory".
- Surface model runs, sync jobs, analysis failures, and runbooks as ops memory.

### Microsoft GraphRAG

Positioning: graph-based RAG over document collections, especially for
cross-document synthesis.

Useful ideas:

- Extract entities and relationships from documents.
- Preserve provenance from graph facts back to source material.
- Use graph communities or topic clusters to answer broad synthesis questions.
- Start small because indexing cost and prompt tuning can be significant.

Limitations for Compound:

- Full GraphRAG is heavier than Compound needs for a personal/team Wiki.
- The cost profile is too high for every small edit or local ingestion.
- Community detection should be incremental and lightweight before any full
  enterprise-style pipeline.

Compound takeaway:

- Implement GraphRAG-lite: typed concept edges, evidence chunks, confidence,
  review gates, graph expansion in retrieval, and topic summaries.
- Avoid a wholesale GraphRAG pipeline unless the corpus becomes large enough to
  justify it.

### Graphify

Positioning: codebase navigation graph for coding agents.

Useful ideas:

- Give coding agents a map before they edit.
- Turn local project files into a queryable graph.
- Reduce repeated repository scanning and token waste.

Limitations for Compound:

- Its main value is developer workflow, not end-user knowledge memory.
- It should not become part of Compound's production runtime.

Compound takeaway:

- Use the idea as a local code-map generator.
- Keep outputs in docs or ignored temp folders.
- Treat it as a maintenance aid for contributors and agents.

### LLM Wiki

Positioning: design pattern for agent-maintained Markdown knowledge bases.

Useful ideas:

- Raw material and compiled Wiki pages are separate layers.
- The Wiki is human-readable Markdown, ideally versioned by Git.
- The agent updates existing pages instead of answering only by online
  retrieval.
- Provenance and review are essential because summarization is lossy.

Limitations for Compound:

- It is a pattern, not a ready-made system.
- Plain Markdown alone is not enough for search, provenance, sync, review, and
  multi-device operation.

Compound takeaway:

- This is the closest match to Compound's product identity.
- Compound should keep SQLite/FTS/evidence for reliability while making Markdown
  export/import first-class.

## Compound Fit Analysis

Compound already has most of the LLM Wiki foundation:

- `sources` store raw materials.
- `concepts` store compiled Wiki pages.
- `concept_versions` stores AI-maintained edit history.
- `concept_evidence` connects concepts to supporting source chunks.
- `concept_relations` is the formal graph layer.
- Ask retrieval already uses rewrite, hybrid retrieval, graph expansion,
  reranking, synthesis, and citation checks.
- Sync, analysis jobs, review queue, metrics, and model runs provide an ops
  layer.

The main gap was not architecture. The main gap was closure:

- Graph tables existed but relation extraction needed to be real.
- Some concept creation paths bypassed server-side indexing/versioning.
- Wiki search in the UI did not fully use the server retrieval stack.
- Markdown export needed frontmatter and import/roundtrip support.
- Review approval needed to apply relation suggestions, not only change status.
- Model telemetry existed but cost aggregation and UI exposure were thin.

## Selection Matrix

| Need                                 | Best reference    | Compound decision                                                       |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------- |
| Personal or team knowledge Wiki      | LLM Wiki          | Core product model.                                                     |
| Cross-document synthesis             | GraphRAG          | Implement lightweight topic summaries and graph retrieval first.        |
| Long-running autonomous agent memory | GBrain            | Borrow ops/knowledge separation only.                                   |
| Coding-agent repo navigation         | Graphify          | Generate docs/code-map.md, no runtime dependency.                       |
| Cheap local-first operation          | LLM Wiki + SQLite | Keep SQLite/FTS/provenance; make Markdown export/import human-readable. |
| Enterprise-scale knowledge graph     | GraphRAG          | Defer until corpus size and usage justify cost.                         |

## Upgrade Direction for Compound

### 1. Data consistency first

All concept changes should update:

- `concepts`
- `concept_versions`
- `concept_fts`
- `concept_evidence` when source-backed
- `concept_relations`
- `activity`

This prevents hidden drift between what the UI shows, what Ask retrieves, and
what export produces.

### 2. GraphRAG-lite relation layer

Implement typed relationships such as:

- `supports`
- `extends`
- `depends_on`
- `example_of`
- `similar_to`
- `related`
- `contradicts`
- `same_as`

Each edge should include confidence and an explanation. Lower-confidence edges
should enter review instead of being blindly applied.

### 3. Review-gated graph changes

Review items for relation suggestions should be actionable:

- Approve: write the typed relation and update related concept links.
- Reject: preserve the audit trail without changing the graph.
- Resolve: acknowledge without applying.

### 4. Markdown roundtrip

Export should produce:

- `wiki/index.md`
- `wiki/concepts/*.md`
- frontmatter with IDs, source IDs, related IDs, categories, timestamps, and
  versions
- `wiki/graph.json`
- topic summary files

Import should read Markdown back by stable concept ID, record versions, and
rebuild search/graph artifacts.

### 5. Retrieval surface upgrade

The UI should not rely only on local title/summary filtering. Search should use
the server Wiki context API so it can benefit from:

- FTS
- source chunks
- evidence
- graph expansion
- future semantic search improvements

### 6. Ops memory

Model and system runs should be visible as operational memory:

- model/task usage
- tokens
- provider-reported cost
- latency
- failures
- sync and analysis backlog

This is the GBrain idea adapted to Compound's architecture.

### 7. Code map for maintainability

Graphify's useful idea is a code navigation map. Compound should keep a local
generator that emits a lightweight import graph into docs, helping both humans
and coding agents orient before large changes.

## Current Implementation Status

The following items have been implemented in the upgrade pass:

- Typed relation persistence and relation queries in `lib/wiki-db.ts`.
- Relation extraction worker in `lib/analysis-worker.ts`.
- Review approval application for `relation_suggestion` in
  `lib/review-queue.ts`.
- Server-side Ask answer archiving at `/api/concepts/archive-answer`.
- Source edit persistence and artifact recompilation via `PATCH /api/data/sources`.
- Markdown export with frontmatter and typed graph edges via `/api/wiki/export`.
- Markdown import via `/api/wiki/import`.
- Topic summaries via `/api/wiki/topics` and `lib/wiki-topics.ts`.
- Wiki UI search wired to `/api/wiki/search`.
- Model run summary endpoint at `/api/ops/model-runs`.
- Model usage/cost summary in the settings model tab.
- Local code map generator: `npm run docs:code-map`.

## Risks and Guardrails

- Do not treat star count as a selection criterion. It indicates attention, not
  fit.
- Do not run full GraphRAG indexing for every small local edit.
- Do not let generated Markdown become detached from SQLite source of truth
  unless a full canonical-file mode is designed.
- Do not allow low-confidence relation extraction to silently reshape the graph.
- Do not remove provenance. LLM Wiki compression is useful but lossy.
- Keep server-only modules behind API routes; client UI should use browser-safe
  clients.

## Recommended Next Steps

1. Add evaluation fixtures for relation extraction and graph expansion.
2. Add a relation graph UI for a single concept's 1-hop and 2-hop neighborhood.
3. Add import preview UI for Markdown roundtrip instead of API-only import.
4. Add cost-by-day chart once enough `model_runs.cost_usd` data exists.
5. Backfill existing databases by running `/api/wiki/rebuild-index` and then a
   relation extraction job for important sources.
6. Add a small golden-query eval suite for broad synthesis questions.

## References

- GBrain: <https://github.com/garrytan/gbrain>
- Microsoft GraphRAG: <https://github.com/microsoft/graphrag>
- Graphify: <https://github.com/safishamsi/graphify>
- LLM Wiki gist: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- Compound architecture: `docs/architecture.md`
- Compound code map: `docs/code-map.md`
