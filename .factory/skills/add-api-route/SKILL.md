---
name: add-api-route
description: Add a new Next.js App Router API route under app/api/ following Compound's conventions for admin auth, Node.js runtime, error handling, and SQLite access. Use this skill whenever the user asks to add or modify a server endpoint.
---

# Add a Next.js API route to Compound

Compound exposes its server features through Next.js App Router route
handlers under `app/api/**/route.ts`. Every route in the repo follows the
same five rules; mirror them so the route is consistent with the rest of
the codebase and passes admin auth + the `check` workflow.

## When to use this skill

- The user asks to "add an endpoint", "expose an API", or "add a route".
- A new feature needs server-side persistence via `lib/server-db.ts` or
  `lib/wiki-db.ts`.
- An external system (cron, GitHub webhook, sync poller) needs a hook.

## Route checklist

1. **File location.** Put the handler at
   `app/api/<segment>/<sub-segment>/route.ts`. The folder hierarchy *is*
   the URL.
2. **Force the Node.js runtime.** Compound depends on `better-sqlite3`,
   `sharp`, and other native bindings that the Edge runtime cannot load.
   Always export:
   ```ts
   export const runtime = 'nodejs';
   ```
3. **Gate with `requireAdmin`** unless the route is intentionally public
   (`/api/health` is the only current exception). The helper handles the
   401/503 responses for unconfigured / unauthorized requests.
4. **Validate the body manually** — no `zod` dependency is installed. Use
   a typed cast and reject malformed input with HTTP 400.
5. **Keep business logic in `lib/`.** Route handlers should orchestrate,
   not implement. This keeps the logic unit-testable via the
   `lib/*.test.ts` runner (see the `add-node-test` skill).

## Canonical template

```ts
// app/api/<segment>/route.ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server-auth';
import { wikiRepo } from '@/lib/wiki-db';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as { query?: string; limit?: number };
    const query = body.query?.trim();
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const result = wikiRepo.searchWikiContext(query, {
      conceptLimit: body.limit ?? 24,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/<segment>] error:', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

This template is taken from `app/api/wiki/search/route.ts` and
`app/api/health/route.ts`; copy it verbatim and adapt the body shape /
repository call.

## Method conventions

| HTTP verb | When to use it |
| --- | --- |
| `GET` | Read-only, idempotent. Always usable from the browser; do **not** rely on a JSON body. |
| `POST` | Mutations and any request that needs a JSON body — including search endpoints that take a query payload. |
| `PUT` / `DELETE` | Avoid; the codebase models updates as `POST` to a sub-path (e.g. `/api/sync/cancel`). |

## Auth variations

- **Public endpoint** (rare): omit `requireAdmin`. Keep it read-only and
  return only safe, non-sensitive data.
- **Webhook endpoint** (e.g. `/api/sync/github/webhook`): verify the
  shared secret manually with a constant-time compare; do *not* call
  `requireAdmin` since the caller is GitHub.
- **Cron endpoint** (e.g. `/api/sync/cron/rescan`): check
  `process.env.CRON_SECRET` against an `Authorization: Bearer ...` header.

## After adding the route

1. Run `npm run typecheck` to catch import path mistakes.
2. If the new logic added a function in `lib/`, add a `lib/*.test.ts`
   covering its happy path and at least one failure case (see the
   `add-node-test` skill).
3. Run `npm run build` to confirm Next.js can statically analyse the
   route. The build will list the new route in the "Route (app)" table.
4. Hit the endpoint locally:
   ```bash
   COMPOUND_ADMIN_TOKEN=dev npm run dev
   curl -H 'Authorization: Bearer dev' \
        -H 'content-type: application/json' \
        -d '{"query":"hello"}' \
        http://localhost:8080/api/<segment>
   ```
