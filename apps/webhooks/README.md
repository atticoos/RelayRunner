# RelayRunner webhooks

GitHub webhook ingress, on its own Cloudflare Worker. It verifies each delivery's signature, turns it into a compact `WebhookMessage` (from `packages/github-webhooks`) and puts it on the `relayrunner-github-webhooks` queue. The API Worker (`apps/api`) consumes the queue and does the work.

```
GitHub ──▶ relayrunner-webhooks ──▶ queue ──▶ relayrunner-api queue()
           verify + enqueue                    │ 6 retries, backoff
                                               ▼
                                              DLQ ──▶ log + ack
```

It is separate from the API so that API deploys, and bugs in processing, never change what GitHub sees. While the API is broken, messages wait and retry (30 seconds, doubling, up to about half an hour in total) instead of failing deliveries. Keep this Worker small: it should rarely need a deploy.

| Response | When                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `200`    | `ping`                                                                                                  |
| `202`    | Queued, or an event RelayRunner doesn't act on                                                          |
| `401`    | Missing or wrong signature                                                                              |
| `500`    | `GITHUB_WEBHOOK_SECRET` can't be read from the Secrets Store                                            |
| `503`    | The queue rejected the message. GitHub doesn't retry, so redeliver it from the App's Recent Deliveries. |

Queue messages carry only the fields the consumer uses, never the raw payload, because a message is capped at 128 KB. Delivery is at least once and unordered, so processing must be idempotent.

## Run it locally

Run it in the same `wrangler dev` as the API so the local queue connects producer and consumer:

```sh
# once: seed the local Secrets Store (prompts for the value)
npx wrangler secrets-store secret create eac3493b9fef4234a832f5f3fdcc8a41 --name GITHUB_WEBHOOK_SECRET --scopes workers -c apps/webhooks/wrangler.jsonc
npx wrangler dev -c apps/webhooks/wrangler.jsonc -c apps/api/wrangler.jsonc
```

## Deploy

Once per account, create the queues:

```sh
wrangler queues create relayrunner-github-webhooks
wrangler queues create relayrunner-github-webhooks-dlq
```

`GITHUB_WEBHOOK_SECRET` already lives in the account's Secrets Store, so there's nothing to set. Then deploy in this order, since each step binds to the one before it:

```sh
pnpm run deploy:webhooks
pnpm run deploy:api    # attaches the queue consumers
pnpm run deploy:web    # forwards /api/webhooks/* here
```

The GitHub App's webhook URL is `https://relayrunner-webhooks.relayrun.workers.dev/api/webhooks/github`, so deliveries reach this Worker directly. `https://webhooks.relayrunner.app/api/webhooks/github` is the same Worker on its custom domain. The dashboard also forwards `/api/webhooks/*` here, so `<dashboard origin>/api/webhooks/github` works too.
