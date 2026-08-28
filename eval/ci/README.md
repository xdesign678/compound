# eval:ci sidecar

Local, deterministic, zero-network eval for the de-identified CI corpus.

## Run

```bash
node scripts/eval-ci.mjs
node --test eval/ci/eval-ci.test.mjs
```

## Hard gates (exit 1)

- parse / run errors
- citation ids resolvable against fixture entities (100%)
- source / chunk / evidence / relation graph connected
- SSE `event: done` payload complete
- `unknown` items must not forge citations

Hit@k, MRR, and keyword recall are printed only.

## Main-thread wiring

Do **not** edit these in the sidecar batch. After merge, add:

```json
"eval:ci": "node scripts/eval-ci.mjs"
```

and a CI step `npm run eval:ci`. Do not point this runner at `eval/golden-set.json` or any private production set.
