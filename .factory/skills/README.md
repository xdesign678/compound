# Compound skills

This directory holds [Claude-style skills](https://code.claude.com/docs/en/skills)
that an AI agent can load on-demand while working in this repository. Each
skill lives in its own folder as `<skill-name>/SKILL.md` with YAML
frontmatter declaring `name` and `description`.

| Skill                                                   | Purpose                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`run-checks`](./run-checks/SKILL.md)                   | Run the local quality gate (`typecheck`, `test`, `build`) the same way CI does.              |
| [`add-api-route`](./add-api-route/SKILL.md)             | Add a Next.js App Router API route under `app/api/` with admin auth and the Node.js runtime. |
| [`add-node-test`](./add-node-test/SKILL.md)             | Write a `lib/*.test.ts` test file picked up by `scripts/run-node-tests.mjs`.                 |
| [`measure-build`](./measure-build/SKILL.md)             | Use `npm run build:measure` to record build duration, cache hits, and bundle size.           |
| [`server-db-migration`](./server-db-migration/SKILL.md) | Evolve the `better-sqlite3` schema in `lib/server-db.ts` / `lib/wiki-db.ts` safely.          |

## How an agent uses these skills

An agent equipped with skill loading (Factory Droid, Claude Code, etc.)
will read this directory, parse each `SKILL.md` frontmatter, and surface
the matching skill when its description fits the user's request. Each
skill is fully self-contained: it states _when_ to apply it, the
project-specific rules, the canonical template, and the verification
steps. There is no implicit shared context, so skills can be loaded
independently.

## Adding a new skill

1. Create `.factory/skills/<skill-name>/SKILL.md`.
2. Start with YAML frontmatter:

   ```markdown
   ---
   name: <skill-name>
   description: One-sentence summary that helps an agent decide when to use it.
   ---
   ```

3. Document, in order: when to use the skill, the project-specific
   rules, a canonical code template, and how to verify the change.
4. Keep skills focused — one workflow per skill. If a skill grows past
   ~200 lines, split it.
