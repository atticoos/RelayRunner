import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { verifyGitHubSignature } from '../github-webhook.ts';

export const webhookRoutes = new Hono<AppEnv>().post('/github', async c => {
  const body = await c.req.text();
  if (!await verifyGitHubSignature(c.env.GITHUB_WEBHOOK_SECRET, body, c.req.header('x-hub-signature-256') ?? null)) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const event = c.req.header('x-github-event');
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
