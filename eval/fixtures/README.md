# CI eval fixtures

`ci-corpus.json` is a de-identified, deterministic fixture. It is safe to run
in CI. It does **not** contain production questions, answers, or concept titles.

Private production-matching eval sets must stay off git. Do not run them unless
explicitly authorized. If a live runner is added later, it may only persist
aggregate metrics.

Hard gates for CI:

- fixture JSON is valid and reconstructable
- every `shouldAnswer=true` item has concept ids or titles
- citation IDs, when present, must refer to fixture corpus ids
