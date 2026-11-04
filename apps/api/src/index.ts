import { app } from "./app.ts";
import type { WebhookMessage } from "@relayrunner/github-webhooks";
import { checkDeadLetterGrowth } from "./dead-letter-alert.ts";
import type { Env } from "./env.ts";
import { handleWebhookBatch } from "./webhook-queue.ts";

export { MachineLink } from "./durable-objects/machine-link.ts";
export { PickRunner } from "./durable-objects/pick-runner.ts";
export { Router } from "./durable-objects/router.ts";

// GitHub webhooks arrive on a queue from the ingress Worker (apps/webhooks), not over HTTP.
export default {
  fetch: app.fetch,
  queue: handleWebhookBatch,
  // Hourly: alert when webhook dead letters pile up.
  async scheduled(_controller, env) {
    await checkDeadLetterGrowth(env);
  },
} satisfies ExportedHandler<Env, WebhookMessage>;
