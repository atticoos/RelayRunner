import { app } from './app.ts';
import type { WebhookMessage } from '@relayrunner/github-webhooks';
import type { Env } from './env.ts';
import { handleWebhookBatch } from './webhook-queue.ts';

export { MachineLink } from './durable-objects/machine-link.ts';
export { PickRunner } from './durable-objects/pick-runner.ts';
export { Router } from './durable-objects/router.ts';

// GitHub webhooks arrive on a queue from the ingress Worker (apps/webhooks), not over HTTP.
export default {
  fetch: app.fetch,
  queue: handleWebhookBatch,
} satisfies ExportedHandler<Env, WebhookMessage>;
