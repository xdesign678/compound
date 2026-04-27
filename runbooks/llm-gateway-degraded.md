# LLM gateway degraded

Use this when Q&A, ingest, analysis, categorization, or repair fails because
the OpenAI-compatible model endpoint is unavailable or misconfigured.

## Impact

- Questions fail or return empty answers.
- New notes import but do not become useful concepts.
- Analysis or repair jobs fail repeatedly.
- Logs show gateway errors, model errors, request timeouts, or DNS/private URL
  blocking.

## Check

1. Confirm the configured model environment:
   - `LLM_API_URL`
   - `LLM_API_KEY`
   - `LLM_MODEL`
2. Check whether the failure is global or user-supplied:
   - Server-owned `LLM_API_KEY` is used only with the configured server endpoint.
   - User-supplied custom endpoints must use the user's own API key.
3. Inspect logs for:
   - `gateway_401`, `gateway_403`, `gateway_429`, `gateway_5xx`
   - timeout messages
   - private or loopback URL rejection
   - `analysis` or `repair` job failures immediately after a gateway call
4. Check whether only remote embeddings are affected. If so, the app can fall
   back to local hash vectors unless `COMPOUND_EMBEDDING_PROVIDER=remote` is
   required for the incident.

## Recovery

1. For 401 or 403, rotate or correct `LLM_API_KEY`.
2. For 429, reduce manual retries and wait for the provider window to reset.
3. For 5xx or timeout, confirm provider status, then switch to a known-good
   compatible endpoint/model if available.
4. If a custom API URL points to a private, loopback, or metadata address,
   remove it. The gateway blocks those URLs by design.
5. After restoring the model path, retry failed analysis or repair work from
   `/sync` or `/review`.

## Verify

- A small authenticated ingest or Q&A request succeeds.
- New analysis jobs stop failing with gateway errors.
- `/sync` and `/review` show decreasing failure counts.
- Logs no longer show repeated gateway failures for the same model path.

## Do not

- Do not bypass SSRF protection to make a custom endpoint work.
- Do not send the server-owned API key to user-supplied endpoints.
- Do not retry large batches before a small model call succeeds.
