import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { verifyGitHubSignature } from '../github-webhook.ts';

export const webhookRoutes = new Hono<AppEnv>().post('/github', async c => {
  const event = c.req.header('x-github-event');
  const delivery = c.req.header('x-github-delivery');

  if (!c.env.GITHUB_WEBHOOK_SECRET) {
    console.error(JSON.stringify({ msg: 'github webhook secret not configured', event, delivery }));
    return c.json({ error: 'webhook_secret_not_configured' }, 500);
  }

  const body = await c.req.text();
  if (!await verifyGitHubSignature(c.env.GITHUB_WEBHOOK_SECRET, body, c.req.header('x-hub-signature-256') ?? null)) {
    console.warn(JSON.stringify({ msg: 'github webhook signature rejected', event, delivery }));
    return c.json({ error: 'invalid_signature' }, 401);
  }

  // Log every verified delivery so Workers Logs / `wrangler tail` shows what GitHub sends.
  // Nothing is processed yet.
  console.log(JSON.stringify({ msg: 'github webhook received', ...summarize(event, delivery, body) }));

  switch (event) {
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

function summarize(event: string | undefined, delivery: string | undefined, body: string) {
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(body);
  } catch {
    // Keep the log line even if the body isn't JSON.
  }
  return {
    event,
    delivery,
    action: payload.action,
    installation: payload.installation?.id,
    repository: payload.repository?.full_name,
    sender: payload.sender?.login,
  };
}
