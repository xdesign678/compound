/**
 * HTTP handling for the GitHub webhook inbox. The Next route is a thin wrapper
 * around `handleGithubWebhookRequest` so persist-before-ACK can be tested
 * without compiling the App Router file.
 *
 * Server-only.
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiError } from './api-error';
import { isRequestBodyTooLargeError, readTextWithLimit } from './request-guards';
import { startGithubSyncFromWebhook } from './github-sync-runner';
import { safeEqual } from './server-auth';
import { webhookRateLimit } from './rate-limit';

const MAX_WEBHOOK_BODY_BYTES = 512_000;

async function verifyGithubWebhookSignature(req: Request, rawBody: string): Promise<boolean> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return false;
  const sig = req.headers.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(sig, expected);
}

export async function handleGithubWebhookRequest(req: Request): Promise<NextResponse> {
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
  if (!(await verifyGithubWebhookSignature(req, rawBody))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = req.headers.get('x-github-event') || '';
  if (event !== 'push' && event !== 'ping') {
    return NextResponse.json({ ignored: true, event });
  }
  if (event === 'ping') return NextResponse.json({ ok: true, event });

  try {
    let payload: { before?: unknown; after?: unknown; ref?: unknown } = {};
    try {
      payload = JSON.parse(rawBody) as { before?: unknown; after?: unknown; ref?: unknown };
    } catch {
      payload = {};
    }
    const deliveryId = req.headers.get('x-github-delivery') || '';
    const { jobId, existing, queued, draining } = startGithubSyncFromWebhook({
      deliveryId,
      event,
      signatureSha256: req.headers.get('x-hub-signature-256') || '',
      ref: typeof payload.ref === 'string' ? payload.ref : undefined,
      beforeSha: typeof payload.before === 'string' ? payload.before : undefined,
      afterSha: typeof payload.after === 'string' ? payload.after : undefined,
    });
    return NextResponse.json({
      jobId,
      existing: !!existing,
      queued: !!queued,
      draining: !!draining,
    });
  } catch (err) {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    return NextResponse.json(apiError(err, requestId, 'sync.github.webhook.failed'), {
      status: 500,
    });
  }
}
