---
name: add-node-test
description: Add a unit test that runs under Node's built-in test runner via npm run test. Use this skill any time you add a new pure helper or refactor logic out of an API route in the Compound repo, so coverage matches CI expectations.
---

# Add a Node.js unit test

Compound does not depend on Jest, Vitest, or Mocha. It uses
`node:test` + `node:assert/strict`, compiled on the fly by
`scripts/run-node-tests.mjs`. Tests are intentionally tiny and fast so
that `npm run check` stays under a few seconds locally.

## When to use this skill

- A user-facing change introduced a new helper in `lib/`.
- You moved logic out of an `app/api/**/route.ts` handler into a `lib/`
  module (the recommended pattern — see the `add-api-route` skill).
- A bug was fixed and you want a regression test.

## Where the test must live

The runner in `scripts/run-node-tests.mjs` discovers tests with this
exact rule:

```js
readdirSync(libDir).filter((name) => name.endsWith('.test.ts'));
```

Therefore:

- File path: `lib/<module>.test.ts` (no nested `__tests__/` directory).
- One test file per module under test, named after that module.
- The compiled output goes to `node_modules/.cache/compound-node-tests`
  and is gitignored.

## Canonical template

```ts
// lib/example.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { exampleHelper } from './example';

test('exampleHelper returns the expected shape on the happy path', () => {
  const result = exampleHelper({ id: '1', text: 'hello' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.tokens, ['hello']);
});

test('exampleHelper rejects empty input', () => {
  assert.throws(() => exampleHelper({ id: '1', text: '' }), /text must be non-empty/);
});
```

The template above mirrors `lib/categorize-status.test.ts`,
`lib/category-normalization.test.ts`, and the rest of the existing test
suite — keep the same import style (`import test from 'node:test'`,
`import assert from 'node:assert/strict'`) so that the TypeScript
compile step succeeds.

## What you can and cannot import

The runner compiles tests with:

```
--module commonjs --target es2022 --lib es2022,dom
--moduleResolution node --esModuleInterop --skipLibCheck
```

That means inside a `lib/*.test.ts` you may import:

- Other `lib/` modules (relative paths, e.g. `./example`).
- Node built-ins (`node:fs`, `node:path`, `node:test`, ...).
- Pure NPM dependencies (e.g. `nanoid`, `marked`).

You may **not** import:

- Anything under `app/` — the runner is not configured with the Next.js
  alias `@/`.
- React components (no JSX support is configured).
- `next/server` or other Next-only runtime globals.

If a function under test references one of those, refactor: keep the
side-effecting call in the route handler and put the pure logic in a
`lib/*.ts` file you can test directly.

## Database-backed tests

When testing functions that touch SQLite (`lib/server-db.ts`,
`lib/wiki-db.ts`, etc.), point the database at a temp directory inside
the test:

```ts
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

test.before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compound-test-'));
  process.env.DATA_DIR = dir;
});
```

The `getServerDb()` helper reads `DATA_DIR` lazily so each test run
gets an isolated SQLite file.

## Running

```bash
npm run test            # all lib/*.test.ts
node --test \
  node_modules/.cache/compound-node-tests/lib/<module>.test.js
                        # single file (after one full run)
```

If you see "No node-side tests found.", confirm your file is at
`lib/<name>.test.ts` (case-sensitive, no nesting).
