import { handleGithubWebhookRequest } from '@/lib/webhook-inbox-http';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GitHub `push` webhook receiver. Verifies the `x-hub-signature-256` HMAC
 * against `GITHUB_WEBHOOK_SECRET`, ignores unrelated events, replies to
 * `ping` events with `{ ok: true }`, and otherwise persists the delivery
 * into the durable webhook inbox in the same transaction before ACK.
 * Duplicate `X-GitHub-Delivery` values are idempotent. A delivery that
 * arrives while another sync is running stays queued until that job
 * finishes or boot recovery drains the inbox. Returns `jobId`, `existing`,
 * and `queued`.
 *
 * Guards: IP rate limit (before HMAC), HMAC SHA-256 signature (no admin
 * token; webhooks are anonymous), body size limit.
 */
export async function POST(req: Request) {
  return handleGithubWebhookRequest(req);
}
