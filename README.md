# Compound

Compound is a private, LLM-powered personal knowledge Wiki. It turns raw notes, links, and Markdown files into concept pages, then lets you ask questions across the evolving Wiki.

## Important security note

Compound stores and processes private knowledge. Do not expose it on the public internet without access protection.

For production deployments, set a strong random token:

```bash
COMPOUND_ADMIN_TOKEN="$(openssl rand -base64 32)"
```

When the token is set, the app supports browser Basic Auth and API requests with either:

```http
Authorization: Bearer <token>
```

or:

```http
X-Compound-Admin-Token: <token>
```

The Settings drawer also has a local “访问保护” field for saving the same token in the current browser.

## Local development

```bash
npm ci
npm run dev
```

In local development, if `COMPOUND_ADMIN_TOKEN` / `ADMIN_TOKEN` is not set, auth is not enforced.

## Environment variables

Copy `.env.example` and edit the values:

```bash
cp .env.example .env.local
```

Required for production:

- `COMPOUND_ADMIN_TOKEN` or `ADMIN_TOKEN`: site/API access protection.
- `LLM_API_URL`: OpenAI-compatible chat completions endpoint, for example `https://api.openai.com/v1/chat/completions`.
- `LLM_API_KEY`: server-side LLM API key.
- `LLM_MODEL`: model name.
- `DATA_DIR`: persistent SQLite directory, for example `/data`.

Required for GitHub/Obsidian server sync:

- `GITHUB_REPO`: `owner/repo` or a GitHub repo URL.
- `GITHUB_TOKEN`: fine-grained PAT with Repository → Contents: Read-only.
- `GITHUB_BRANCH`: defaults to `main`.

Optional sync/analysis controls:

- `GITHUB_WEBHOOK_SECRET`: verifies `/api/sync/github/webhook` push events.
- `CRON_SECRET`: allows scheduled full rescan through `/api/sync/cron/rescan`.
- `COMPOUND_GITHUB_DELETE_MODE`: `soft` by default; set `hard` to remove local records when remote files disappear.
- `COMPOUND_EMBEDDING_PROVIDER`: `local` by default; set `remote` only when an embedding endpoint is configured.
- `COMPOUND_EMBEDDING_API_KEY`, `COMPOUND_EMBEDDING_API_URL`, `COMPOUND_EMBEDDING_MODEL`: optional remote embedding settings.
- `COMPOUND_DISABLE_HYBRID_SEARCH=true`: disables embedding-assisted retrieval and uses FTS only.

## Docker

```bash
docker build -t compound .
docker run --rm -p 3000:3000 \
  -e COMPOUND_ADMIN_TOKEN=change-me \
  -e LLM_API_URL=https://api.openai.com/v1/chat/completions \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-4o-mini \
  -v compound-data:/data \
  compound
```

## Deployment notes

- GitHub sync uses a long-running Node process and a SQLite-backed job table. Prefer container deployment over serverless.
- `/sync` shows run-level progress, file-level status, analysis worker state, retry/cancel controls, and index coverage.
- `/review` shows low-confidence or large-change review items before they are accepted by a human.
- The service writes SQLite data under `DATA_DIR`.
- The browser also keeps an IndexedDB cache for fast local reads.
- User-supplied custom LLM endpoints must use the user’s own API key. The server-owned key is never sent to a user-supplied URL.

## Checks

```bash
npm run typecheck
npm run test
npm run build
```
