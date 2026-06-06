import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { isRequestBodyTooLargeError, readTextWithLimit } from '@/lib/request-guards';
import { startGithubSyncFromWebhook } from '@/lib/github-sync-runner';
import { safeEqual } from '@/lib/server-auth';
import { webhookRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_WEBHOOK_BODY_BYTES = 512_000;

async function verify(req: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const sig = req.headers.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(sig, expected);
}

/**
 * GitHub `push` webhook receiver. Verifies the `x-hub-signature-256` HMAC
 * against `GITHUB_WEBHOOK_SECRET`, ignores unrelated events, replies to
 * `ping` events with `{ ok: true }`, and otherwise enqueues a webhook-
 * triggered sync via `startGithubSync`. Returns the resulting `jobId` and
 * an `existing` flag indicating whether a job was already running.
 *
 * Guards: IP rate limit (before HMAC), HMAC SHA-256 signature (no admin
 * token; webhooks are anonymous), body size limit.
 */
export async function POST(req: Request) {
  // IP rate limit before expensive HMAC computation
  const blocked = webhookRateLimit(req);
  if (blocked) return blocked;

  let rawBody = '';
  try {
    rawBody = await readTextWithLimit(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  if (!(await verify(req, rawBody)))
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  const event = req.headers.get('x-github-event') || '';
  if (event !== 'push' && event !== 'ping') {
    return NextResponse.json({ ignored: true, event });
  }
  if (event === 'ping') return NextResponse.json({ ok: true, event });

  try {
    let payload: { before?: unknown; after?: unknown } = {};
    try {
      payload = JSON.parse(rawBody) as { before?: unknown; after?: unknown };
    } catch {
      payload = {};
    }
    const deliveryId = req.headers.get('x-github-delivery') || '';
    const { jobId, existing } = startGithubSyncFromWebhook({
      deliveryId,
      event,
      signatureSha256: req.headers.get('x-hub-signature-256') || '',
      beforeSha: typeof payload.before === 'string' ? payload.before : undefined,
      afterSha: typeof payload.after === 'string' ? payload.after : undefined,
    });
    return NextResponse.json({ jobId, existing: !!existing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
