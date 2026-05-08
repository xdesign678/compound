# Query Eval

`golden-set.json` is a repeatable Q&A suite for the Wiki query pipeline. It
expects the target environment to contain the LLM Wiki concept set named in each
item's `expectedConceptTitles`.

Important guardrail: do not treat title misses as answer keyword misses. The eval
runner now reads `retrievedConcepts` and `citedConcepts` from `/api/query` and
scores title-based hit@k against those titles directly.

The production environment at `https://compund.zeabur.app` currently retrieves
UX/cognitive-science concepts for the first LLM Wiki golden questions, which
means the deployed Wiki data does not match this golden set. That is a data
profile mismatch, not a reason to fake hits or weaken the expectations.

Use one of these approaches:

- Run `golden-set.json` against a local or staging Wiki seeded with the LLM Wiki
  concepts.
- Add a separate production golden file based on the concepts actually present in
  the deployed Wiki.

Example:

```bash
COMPOUND_ADMIN_TOKEN="REPLACE_WITH_ADMIN_TOKEN" node scripts/eval-query.mjs \
  --base-url https://compund.zeabur.app \
  --golden eval/golden-set.json \
  --timeout-ms 60000
```
