# Ask/Search Optimization

## Current Pipeline

`POST /api/query` runs the Wiki Q&A path in seven stages:

1. `rewrite`: `rewriteQuery` rewrites follow-up questions only when recent chat history
   and pronouns make the current question ambiguous.
2. `retrieve`: `hybridSearchWikiContext` uses SQLite FTS5 first. When a real
   embedding endpoint is configured it adds vector reranking over FTS-filtered
   chunks; in the current production baseline the mode is `fts-only`.
3. `graph`: `graphExpand` adds one-hop related concepts from `concept_relations`.
4. `rerank`: request-mentioned concepts, FTS concepts, graph neighbors, and chunks
   are fused with RRF. A bounded LLM reranker is used only when it adds likely
   value.
5. `synthesize`: the selected concepts, evidence rows, and chunks are compressed
   into the answer prompt and sent to the query model.
6. citation filtering: returned `citedConceptIds` are restricted to concepts in
   the selected context.
7. faithfulness: local token-overlap checks classify citation support without an
   extra LLM call.

The API reports `stageDurations` for `rewrite`, `retrieve`, `graph`, `rerank`,
and `synthesize`, plus `retrievalMode`, `rerankUsed`, `rerankReason`,
`retrievedConcepts`, and `citedConcepts` for eval/debugging.

## Online Baseline

Baseline target: `https://compund.zeabur.app`.

Guard check before eval:

| Endpoint               | Status |
| ---------------------- | -----: |
| `GET /api/health`      |    200 |
| `GET /api/wiki/health` |    200 |
| `POST /api/query`      |    200 |

Single probe before changes:

| Metric         |      Value |
| -------------- | ---------: |
| total latency  |   17663 ms |
| retrieval mode | `fts-only` |
| rewrite        |       0 ms |
| retrieve       |       4 ms |
| graph          |       1 ms |
| rerank         |    9670 ms |
| synthesize     |    7932 ms |

Five fixed golden queries before changes:

| Metric         |    Value |
| -------------- | -------: |
| avg latency    | 32050 ms |
| p95 latency    | 69712 ms |
| hit@8          |    0.000 |
| keyword recall |    0.250 |
| errored        |        0 |

Per-item before details were saved to `tmp/eval/before-online.json` and
`tmp/eval/before-online.md`.

## Slow Point Attribution

Retrieval itself is not the bottleneck in the measured production mode.
`retrieve` and `graph` complete in single-digit milliseconds. The dominant costs
are remote LLM calls:

- `rerank`: one measured probe spent 9.7 s reranking even though production was
  `fts-only`, where lexical ordering and RRF already define the candidate order.
- `synthesize`: the answer call spent 7.9 s on the same probe and longer on the
  slow eval cases.
- eval instability: the golden set mostly uses `expectedConceptTitles`, but the
  old `/api/query` response only exposed cited ids. The runner therefore could
  not score title-based hit@k reliably and approximated titles as answer
  keywords, which mixed retrieval quality with generation phrasing.

## Landed Changes

1. Adaptive rerank fast path:
   - `fts-only` and `local-hash` modes now skip the LLM reranker by default and
     preserve the RRF/FTS order.
   - Remote embedding mode can still use LLM rerank when the candidate set is
     larger than final top-K.
   - `COMPOUND_RERANK_FTS_ONLY=true` can opt back into LLM rerank for lexical
     mode if production data proves it helps.

2. Candidate and prompt budgets:
   - rerank candidates are clipped before any optional LLM rerank
     (`COMPOUND_RERANK_CANDIDATE_LIMIT`, default derived from final top-K).
   - synthesis context now has explicit budgets for concept body, evidence,
     and chunk text while still preserving all three evidence surfaces.
   - query synthesis max tokens default dropped from 2200 to 1600 with
     `COMPOUND_QUERY_SYNTHESIS_MAX_TOKENS` override.

3. Eval and telemetry:
   - each eval item records total latency, `stageDurations`, `retrievalMode`,
     `rerankUsed`, `rerankReason`, cited ids, and `errorType`.
   - `tmp/eval/latest.json` and `tmp/eval/latest.md` include per-item stage
     breakdowns.
   - per-item timeout defaults to 60 s, so one slow query is marked as a slow
     case and the rest of the suite continues.
   - `/api/query` now returns `retrievedConcepts` and `citedConcepts` with titles
     so title-based golden expectations are scored as retrieval hits instead of
     being folded into answer keyword recall.

## Open-Source Mapping

The local research note in `docs/ai-memory-solution-research.md` remains the
primary product direction: keep Compound as a human-readable LLM Wiki with
SQLite/FTS/provenance, not a wholesale external memory system.

| Reference          | Borrowed idea                                                                | Compound mapping                                                                             |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| LLM Wiki           | durable, curated Wiki pages rather than query-only chunk memory              | keep concept pages as first-class answer context and preserve citation/evidence requirements |
| Microsoft GraphRAG | graph-aware retrieval and structured relations                               | continue the lightweight `graphExpand` one-hop layer before considering community detection  |
| GBrain             | separate operational logs from durable knowledge                             | keep eval/telemetry in `tmp/eval` and model-run tables, not in user Wiki pages               |
| Graphify           | generated code/knowledge maps as navigation aids                             | keep this as docs/code-map style tooling, not a runtime query dependency                     |
| LlamaIndex         | retrieval, node postprocessing/rerank, then citation-aware synthesis         | make rerank a bounded postprocessor and surface cited/retrieved source metadata              |
| Qdrant             | hybrid retrieval and multi-stage queries                                     | mirror the pattern locally with FTS prefilter + optional vector path, no external vector DB  |
| Khoj               | local-first search defaults and confidence-style result surfacing            | keep `fts-only` viable and expose retrieval/rerank mode in telemetry                         |
| Onyx               | search/chat share indexed knowledge and stage-specific retrieval diagnostics | keep API-level stage metrics and per-query eval output for production debugging              |

References:

- `docs/ai-memory-solution-research.md`
- <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- <https://github.com/microsoft/graphrag>
- <https://github.com/garrytan/gbrain>
- <https://github.com/safishamsi/graphify>
- <https://docs.llamaindex.ai/en/stable/api_reference/query_engine/citation/>
- <https://qdrant.tech/documentation/search/hybrid-queries/>
- <https://docs.khoj.dev/features/search/>
- <https://docs.onyx.app/overview/core_features/internal_search>

## After Metrics

Post-deploy target: `https://compund.zeabur.app`.

Deployment probe after changes:

| Metric         |           Value |
| -------------- | --------------: |
| total latency  |        19581 ms |
| retrieval mode |      `fts-only` |
| rerank used    |      `fallback` |
| rerank reason  | `fts-fast-path` |
| rewrite        |            0 ms |
| retrieve       |          176 ms |
| graph          |            2 ms |
| rerank         |            1 ms |
| synthesize     |        19095 ms |

Five fixed golden queries after changes:

| Metric         |    Before |    After |          Delta |
| -------------- | --------: | -------: | -------------: |
| avg latency    |  32050 ms | 24109 ms |       -7941 ms |
| p95 latency    |  69712 ms | 34000 ms |      -35712 ms |
| hit@8          |     0.000 |    0.000 |          0.000 |
| keyword recall |     0.250 |    0.133 |         -0.117 |
| errored        |         0 |        0 |              0 |
| rerank p95     | ~24627 ms |     0 ms | removed in FTS |

Per-item after details were saved to `tmp/eval/after-online.json` and
`tmp/eval/after-online.md`.

## Golden Eval Stability Finding

The post-deploy eval now records retrieved concept titles, so the hit@8 miss is
no longer opaque. The five LLM Wiki golden questions did not retrieve the
expected LLM Wiki concepts in production. Example retrieved titles for
`definition-001` were:

- `三时态认知框架`
- `设计令牌`
- `残留注视`
- `系统状态可见性原则`
- `共同复杂性管理`
- `Jakob Nielsen十大可用性原则`
- `认知负荷管理`
- `工作记忆容量`

For `definition-002` through `definition-005`, production repeatedly retrieved
UX/cognitive-science concepts such as `心智模型`, `现实世界匹配原则`, `自由能原理`,
and `认知负荷理论`.

Root cause: the current production Wiki data does not match the LLM Wiki golden
set. The eval harness is now stable enough to show this honestly instead of
turning expected titles into answer keywords. The correct fix is to run this
golden set only against a Wiki seeded with the LLM Wiki concepts, or add a
separate production golden set derived from the currently deployed Wiki content.
Do not mark these misses as hits unless production data contains the expected
concepts.

## Remaining Risks

- The fast path assumes FTS/RRF order is trustworthy when no real embedding
  endpoint is active. If production data shows recall loss, enable
  `COMPOUND_RERANK_FTS_ONLY=true` selectively and compare eval output.
- Synthesis is still a remote LLM call and remains the dominant unavoidable
  latency component. Prompt compression reduces input size but does not remove
  model/provider variance.
- Golden title hit@k now depends on the deployed API returning
  `retrievedConcepts`; older deployments will still show title misses.
