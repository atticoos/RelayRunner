import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { verifyGitHubSignature } from '../github-webhook.ts';
import { logger } from '../logger.ts';

const baseLog = logger('webhooks.github');

export const webhookRoutes = new Hono<AppEnv>().post('/github', async c => {
  const githubEvent = c.req.header('x-github-event');
  const log = baseLog.with({ githubEvent, deliveryId: c.req.header('x-github-delivery') });

  if (!c.env.GITHUB_WEBHOOK_SECRET) {
    log.error('webhook.secret_missing');
    return c.json({ error: 'webhook_secret_not_configured' }, 500);
  }

  const body = await c.req.text();
  if (!await verifyGitHubSignature(c.env.GITHUB_WEBHOOK_SECRET, body, c.req.header('x-hub-signature-256') ?? null)) {
    log.warn('webhook.signature_rejected');
    return c.json({ error: 'invalid_signature' }, 401);
  }

  // Log every verified delivery so Workers Logs / `wrangler tail` shows what GitHub sends.
  // Nothing is processed yet.
  log.info('webhook.received', summarize(body));

  switch (githubEvent) {
    case 'ping':
      return c.json({ ok: true });
    case 'workflow_job':
      // TODO: on `queued` for a repo that uses RelayRunner, hand the job to that repo's Router,
      // which wakes a PickRunner. See the spike in PR #21 for the flow.
      return c.body(null, 202);
    case 'installation':
    case 'installation_repositories':
      // TODO: record which repos the GitHub App can see.
      return c.body(null, 202);
    default:
      return c.body(null, 202);
  }
});

function summarize(body: string) {
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(body);
  } catch {
    // Keep the log line even if the body isn't JSON.
  }
  return {
    action: payload.action,
    installationId: payload.installation?.id,
    repo: payload.repository?.full_name,
    sender: payload.sender?.login,
  };
}
