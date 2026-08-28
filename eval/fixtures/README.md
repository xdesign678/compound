# CI eval fixtures

`ci-corpus.json` is a de-identified, deterministic fixture. It is safe to run
in CI. It does **not** contain production questions, answers, or concept titles.

The fixture is a full synthetic corpus, not just a question list:

- `sources`, `concepts`, `chunks`, `evidence`, `relations` — entities that
  citation ids must resolve to, with a connected source → chunk → evidence →
  concept graph
- `items` — at least one `one-hop`, one `multi-hop`, and one `unknown` query
- each item's `expectedOutput.sseEvents` is the query/output contract,
  including a complete `event: done` payload with concept / source / chunk /
  evidence citation ids

Private production-matching eval sets must stay off git. Do not run them unless
explicitly authorized. If a live runner is added later, it may only persist
aggregate metrics.

Hard gates for `node scripts/eval-ci.mjs`:

- fixture JSON is valid and reconstructable (parse / run errors = 0)
- citation IDs resolve 100% to fixture corpus ids
- source / chunk / evidence relations are connected
- SSE `done` contract is complete
- `unknown` items must not forge citations
- hit@k / MRR / keyword recall are report-only
