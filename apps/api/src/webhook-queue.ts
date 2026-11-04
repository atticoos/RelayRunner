/**
 * Queue consumer for GitHub webhooks. The ingress Worker (apps/webhooks) verifies each delivery and
 * sends a compact WebhookMessage to `relayrunner-github-webhooks`; this Worker processes it.
 *
 * Each message is acked or retried on its own, so one failing delivery never re-runs its
 * batchmates. Retries back off exponentially (see retryDelaySeconds), so the retry budget spans
 * about half an hour: long enough to roll back a bad API deploy before anything is dead-lettered.
 *
 * After max_retries a message moves to `relayrunner-github-webhooks-dlq`. That is terminal: the
 * consumer logs the full message (the replay source, alongside GitHub's Recent Deliveries) and
 * acks it.
 *
 * Delivery is at least once and unordered. A redelivery or a queue retry can repeat a message, and
 * `workflow_job` `queued` can arrive after `in_progress`, so processing must be idempotent and
 * keyed on the job's state, not on arrival order.
 */
import { WEBHOOK_DLQ, type WebhookMessage } from '@relayrunner/github-webhooks';
import { eq } from 'drizzle-orm';
import { createDb, schema } from './db/index.ts';
import type { Env } from './env.ts';
import { upsertInstallation } from './installations.ts';

const BASE_RETRY_DELAY_SECONDS = 30;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

/** Handle one batch from the webhook queue or its DLQ. Never throws. */
export async function handleWebhookBatch(batch: MessageBatch<WebhookMessage>, env: Env): Promise<void> {
  const isDlq = batch.queue === WEBHOOK_DLQ;
  for (const msg of batch.messages) {
    if (isDlq) {
      console.error(JSON.stringify({ msg: 'github webhook dead-lettered', deliveryId: msg.body.deliveryId, attempts: msg.attempts, message: msg.body }));
      msg.ack();
      continue;
    }
    try {
      await processWebhook(env, msg.body);
      msg.ack();
    } catch (error) {
      const delaySeconds = retryDelaySeconds(msg.attempts);
      console.warn(JSON.stringify({
        msg: 'github webhook processing failed; retrying',
        event: msg.body.event,
        deliveryId: msg.body.deliveryId,
        attempts: msg.attempts,
        delaySeconds,
        error: error instanceof Error ? error.message : String(error),
      }));
      msg.retry({ delaySeconds });
    }
  }
}

// 30s, 60s, 120s, ... capped at 15 minutes. `attempts` starts at 1.
export function retryDelaySeconds(attempts: number) {
  return Math.min(BASE_RETRY_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_SECONDS);
}

/** Do the work for one delivery. Throw to retry. */
export async function processWebhook(env: Env, message: WebhookMessage): Promise<void> {
  const lagMs = Date.now() - Date.parse(message.receivedAt);
  switch (message.event) {
    case 'workflow_job':
      // TODO: on `queued` for a repo that uses RelayRunner, hand the job to that repo's Router,
      // which wakes a PickRunner. See the spike in PR #21 for the flow.
      console.log(JSON.stringify({
        msg: 'github webhook processed',
        event: message.event,
        action: message.action,
        deliveryId: message.deliveryId,
        repository: message.repository.fullName,
        jobId: message.job.id,
        labels: message.job.labels,
        lagMs,
      }));
      return;
    case 'installation':
    case 'installation_repositories':
      await recordInstallation(env, message);
      console.log(JSON.stringify({ msg: 'github webhook processed', event: message.event, action: message.action, deliveryId: message.deliveryId, installationId: message.installationId, lagMs }));
      return;
  }
}

// Keeps github_installation in step with GitHub so the dashboard shows each org's real status.
// Every action carries the installation's current state, so applying it is idempotent and order
// doesn't matter much; `deleted` removes the row (the workspace drops the org and the owner
// reconnects it). Never sets workspace_id: linking takes a signed-in user (routes/github.ts).
async function recordInstallation(env: Env, message: Extract<WebhookMessage, { event: 'installation' | 'installation_repositories' }>) {
  const installation = message.installation;
  if (!installation) return;
  const db = createDb(env.DB);
  if (message.event === 'installation' && message.action === 'deleted') {
    await db.delete(schema.githubInstallation).where(eq(schema.githubInstallation.id, installation.id));
    return;
  }
  await upsertInstallation(db, {
    id: installation.id,
    account: installation.account,
    repository_selection: installation.repositorySelection,
    suspended_at: installation.suspendedAt,
  }, new Date(message.receivedAt));
}
