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
import { WEBHOOK_DLQ, type WebhookMessage } from "@relayrunner/github-webhooks";
import { eq } from "drizzle-orm";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";
import { upsertInstallation } from "./installations.ts";
import { recordRepositoryEvent, removeRepositories, upsertRepositories } from "./repositories.ts";
import { routeIdFromLabels } from "./routing.ts";

// The `runs-on` label that routes a job through RelayRunner.
export const RELAYRUNNER_LABEL = "relayrunner";

const BASE_RETRY_DELAY_SECONDS = 30;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

/** Handle one batch from the webhook queue or its DLQ. Never throws. */
export async function handleWebhookBatch(
  batch: MessageBatch<WebhookMessage>,
  env: Env,
): Promise<void> {
  const isDlq = batch.queue === WEBHOOK_DLQ;
  for (const msg of batch.messages) {
    if (isDlq) {
      console.error(
        JSON.stringify({
          msg: "github webhook dead-lettered",
          deliveryId: msg.body.deliveryId,
          attempts: msg.attempts,
          message: msg.body,
        }),
      );
      msg.ack();
      continue;
    }
    try {
      await processWebhook(env, msg.body);
      msg.ack();
    } catch (error) {
      const delaySeconds = retryDelaySeconds(msg.attempts);
      console.warn(
        JSON.stringify({
          msg: "github webhook processing failed; retrying",
          event: msg.body.event,
          deliveryId: msg.body.deliveryId,
          attempts: msg.attempts,
          delaySeconds,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      msg.retry({ delaySeconds });
    }
  }
}

// GitHub matches runs-on labels case-insensitively, so `RelayRunner` counts too.
export function usesRelayRunner(labels: string[]) {
  return labels.some((label) => label.toLowerCase() === RELAYRUNNER_LABEL);
}

// 30s, 60s, 120s, ... capped at 15 minutes. `attempts` starts at 1.
export function retryDelaySeconds(attempts: number) {
  return Math.min(
    BASE_RETRY_DELAY_SECONDS * 2 ** Math.max(0, attempts - 1),
    MAX_RETRY_DELAY_SECONDS,
  );
}

/** Do the work for one delivery. Throw to retry. */
export async function processWebhook(env: Env, message: WebhookMessage): Promise<void> {
  const lagMs = Date.now() - Date.parse(message.receivedAt);
  switch (message.event) {
    case "workflow_job": {
      // A job on a route's `rr-<id>` label: the run's pick chose a machine for it.
      const routeId = routeIdFromLabels(message.job.labels);
      if (routeId) return dispatchRoute(env, message, routeId, lagMs);
      // Only jobs that ask for RelayRunner (`runs-on: relayrunner`) are ours. Everything else the
      // App sees is some other runner's job, so drop it quietly.
      if (!usesRelayRunner(message.job.labels)) return;
      // On `queued`, wake a PickRunner for the job, which answers it with the Router's route. Other
      // actions are only logged. Nothing is stored yet (#48).
      console.log(
        JSON.stringify({
          msg: "relayrunner job received",
          action: message.action,
          deliveryId: message.deliveryId,
          installationId: message.installationId,
          repository: message.repository.fullName,
          jobId: message.job.id,
          runId: message.job.runId,
          runAttempt: message.job.runAttempt,
          job: message.job.name,
          workflow: message.job.workflowName,
          labels: message.job.labels,
          runnerName: message.job.runnerName,
          lagMs,
        }),
      );
      if (message.action === "queued" && message.installationId) {
        await env.PICK_RUNNER.getByName(String(message.job.id)).start({
          jobId: message.job.id,
          installationId: message.installationId,
          repo: message.repository.fullName,
        });
      }
      return;
    }
    case "installation":
    case "installation_repositories":
      await recordInstallation(env, message);
      console.log(
        JSON.stringify({
          msg: "github webhook processed",
          event: message.event,
          action: message.action,
          deliveryId: message.deliveryId,
          installationId: message.installationId,
          lagMs,
        }),
      );
      return;
    case "repository":
      if (message.installationId) {
        await recordRepositoryEvent(
          createDb(env.DB),
          message.installationId,
          message.action,
          message.repository,
          new Date(message.receivedAt),
        );
      }
      console.log(
        JSON.stringify({
          msg: "github webhook processed",
          event: message.event,
          action: message.action,
          deliveryId: message.deliveryId,
          installationId: message.installationId,
          repository: message.repository.fullName,
          lagMs,
        }),
      );
      return;
  }
}

// Hands a queued route job to the route's machine. The Router only gives the route to a job from
// the same repo and run as the pick that made it, so another repo can't borrow a machine by
// copying a label; anything else gets nothing and stays queued. Other actions are only logged.
async function dispatchRoute(
  env: Env,
  message: Extract<WebhookMessage, { event: "workflow_job" }>,
  routeId: string,
  lagMs: number,
) {
  const log = {
    msg: "relayrunner route job",
    action: message.action,
    deliveryId: message.deliveryId,
    installationId: message.installationId,
    repository: message.repository.fullName,
    jobId: message.job.id,
    runId: message.job.runId,
    job: message.job.name,
    routeId,
    runnerName: message.job.runnerName,
    conclusion: message.job.conclusion,
    lagMs,
  };
  if (message.action !== "queued" || !message.installationId) {
    console.log(JSON.stringify(log));
    return;
  }
  const [installation] = await createDb(env.DB)
    .select({ workspaceId: schema.githubInstallation.workspaceId })
    .from(schema.githubInstallation)
    .where(eq(schema.githubInstallation.id, message.installationId))
    .limit(1);
  const workspaceId = installation?.workspaceId;
  const route = workspaceId
    ? await env.ROUTER.getByName(workspaceId).claim(routeId, {
        jobId: message.job.id,
        repositoryId: message.repository.id,
        runId: message.job.runId,
      })
    : null;
  if (!workspaceId || !route) {
    console.warn(JSON.stringify({ ...log, result: "no_route" }));
    return;
  }
  const result = await env.MACHINE_LINK.getByName(route.machineId).run({ route, workspaceId });
  (result === "offline" ? console.warn : console.log)(
    JSON.stringify({ ...log, result, machineId: route.machineId }),
  );
}

// Keeps github_installation, and the repos it can see, in step with GitHub so the dashboard shows
// each org's real status.
// Every action carries the installation's current state, so a repeat is harmless, and
// upsertInstallation drops anything older than what the row holds (the queue is unordered and
// retries). `deleted` removes the row: the workspace drops the org and the owner reconnects it. A
// stale event landing after that can recreate it unclaimed, which is harmless: it is listed or
// claimable only while GitHub still shows the install to the user. Its repos go with the row
// (ON DELETE CASCADE). Never sets workspace_id: linking takes a signed-in user (routes/github.ts).
async function recordInstallation(
  env: Env,
  message: Extract<WebhookMessage, { event: "installation" | "installation_repositories" }>,
) {
  const db = createDb(env.DB);
  // Uses installationId, not the summary, so a message from an ingress that predates the summary
  // still removes the org.
  if (message.event === "installation" && message.action === "deleted") {
    if (message.installationId)
      await db
        .delete(schema.githubInstallation)
        .where(eq(schema.githubInstallation.id, message.installationId));
    return;
  }
  const installation = message.installation;
  if (!installation) return;
  const observedAt = new Date(message.receivedAt);
  await upsertInstallation(
    db,
    {
      id: installation.id,
      account: installation.account,
      repository_selection: installation.repositorySelection,
      suspended_at: installation.suspendedAt,
    },
    observedAt,
  );
  // `created` lists every repo the installation can see; other actions carry none.
  if (message.event === "installation") {
    await upsertRepositories(db, installation.id, message.repositories, observedAt);
    return;
  }
  await upsertRepositories(db, installation.id, message.added, observedAt);
  await removeRepositories(db, installation.id, message.removed, observedAt);
}
