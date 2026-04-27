import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { startGithubSync } from '@/lib/github-sync-runner';

export const runtime = 'nodejs';
export const maxDuration = 30;

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

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
 * Guards: HMAC SHA-256 signature (no admin token; webhooks are anonymous).
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!(await verify(req, rawBody)))
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  const event = req.headers.get('x-github-event') || '';
  if (event !== 'push' && event !== 'ping') {
    return NextResponse.json({ ignored: true, event });
  }
  if (event === 'ping') return NextResponse.json({ ok: true, event });

  try {
    const { jobId, existing } = startGithubSync({ triggerType: 'webhook' });
    return NextResponse.json({ jobId, existing: !!existing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
