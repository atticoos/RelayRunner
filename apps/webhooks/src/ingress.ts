/**
 * GitHub webhook ingress. Verifies each delivery, turns it into a compact WebhookMessage and puts it
 * on the `relayrunner-github-webhooks` queue. The API Worker consumes that queue and does the work.
 *
 * This Worker is kept apart from the API so that API deploys, and bugs in processing, never change
 * what GitHub sees: a bad API deploy only makes messages retry (and, past the retry budget, land in
 * the dead letter queue), it never fails a delivery. Keep this file small and boring.
 *
 * Responses, as GitHub's Recent Deliveries shows them:
 * - 200 ping
 * - 202 accepted (queued, or an event RelayRunner doesn't act on)
 * - 401 bad or missing signature
 * - 500 GITHUB_WEBHOOK_SECRET can't be read from the Secrets Store
 * - 503 the queue rejected the message; GitHub doesn't retry, so redeliver from the App settings
 */
import { toWebhookMessage, verifyGitHubSignature, type WebhookMessage } from '@relayrunner/github-webhooks';

export interface Env {
  WEBHOOK_QUEUE: Queue<WebhookMessage>;
  // Secrets Store binding; read with get().
  GITHUB_WEBHOOK_SECRET: SecretsStoreSecret;
}

// The path GitHub posts to. The dashboard Worker forwards /api/webhooks/* here over a service
// binding, so the GitHub App's existing webhook URL keeps working; this Worker's own workers.dev
// URL answers the same path.
const WEBHOOK_PATH = '/api/webhooks/github';

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname !== WEBHOOK_PATH) return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const event = request.headers.get('x-github-event') ?? '';
  const deliveryId = request.headers.get('x-github-delivery') ?? '';

  const secret = await readSecret(env.GITHUB_WEBHOOK_SECRET);
  if (!secret) {
    log('error', 'github webhook secret not configured', { event, deliveryId });
    return json({ error: 'webhook_secret_not_configured' }, 500);
  }

  const body = await request.text();
  if (!await verifyGitHubSignature(secret, body, request.headers.get('x-hub-signature-256'))) {
    log('warn', 'github webhook signature rejected', { event, deliveryId });
    return json({ error: 'invalid_signature' }, 401);
  }

  if (event === 'ping') {
    log('log', 'github webhook received', { event, deliveryId });
    return json({ ok: true }, 200);
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    // A signed body that isn't JSON: nothing to act on.
  }

  const message = toWebhookMessage(event, deliveryId, payload);
  const summary = { event, deliveryId, action: (payload as any)?.action, installationId: (payload as any)?.installation?.id, repository: (payload as any)?.repository?.full_name };
  if (!message) {
    log('log', 'github webhook ignored', summary);
    return new Response(null, { status: 202 });
  }

  try {
    await env.WEBHOOK_QUEUE.send(message);
  } catch (error) {
    log('error', 'github webhook enqueue failed', { ...summary, error: error instanceof Error ? error.message : String(error) });
    return json({ error: 'enqueue_failed' }, 503);
  }
  log('log', 'github webhook queued', summary);
  return new Response(null, { status: 202 });
}

// The binding is missing when wrangler.jsonc doesn't declare it, and get() throws when the store has
// no secret by that name. Both mean "not configured".
async function readSecret(binding: SecretsStoreSecret | undefined) {
  try {
    return binding ? await binding.get() : null;
  } catch {
    return null;
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

function log(level: 'log' | 'warn' | 'error', msg: string, fields: Record<string, unknown>) {
  console[level](JSON.stringify({ msg, ...fields }));
}
