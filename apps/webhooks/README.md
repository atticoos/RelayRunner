# RelayRunner webhooks

GitHub webhook ingress, on its own Cloudflare Worker. It verifies each delivery's signature, turns it into a compact `WebhookMessage` (from `packages/github-webhooks`) and puts it on the `relayrunner-github-webhooks` queue. The API Worker (`apps/api`) consumes the queue and does the work.

```
GitHub ──▶ relayrunner-app ──▶ relayrunner-webhooks ──▶ queue ──▶ relayrunner-api queue()
           /api/webhooks/*      verify + enqueue                    │ 6 retries, backoff
                                                                    ▼
                                                                   DLQ ──▶ log + ack
```

It is separate from the API so that API deploys, and bugs in processing, never change what GitHub sees. While the API is broken, messages wait and retry (30 seconds, doubling, up to about half an hour in total) instead of failing deliveries. Keep this Worker small: it should rarely need a deploy.

| Response | When |
| --- | --- |
| `200` | `ping` |
| `202` | Queued, or an event RelayRunner doesn't act on |
| `401` | Missing or wrong signature |
| `500` | `GITHUB_WEBHOOK_SECRET` isn't set |
| `503` | The queue rejected the message. GitHub doesn't retry, so redeliver it from the App's Recent Deliveries. |

Queue messages carry only the fields the consumer uses, never the raw payload, because a message is capped at 128 KB. Delivery is at least once and unordered, so processing must be idempotent.

## Run it locally

Run it in the same `wrangler dev` as the API so the local queue connects producer and consumer:

```sh
cp apps/webhooks/.dev.vars.example apps/webhooks/.dev.vars   # set GITHUB_WEBHOOK_SECRET
npx wrangler dev -c apps/webhooks/wrangler.jsonc -c apps/api/wrangler.jsonc
```

## Deploy

Once per account, create the queues:

```sh
wrangler queues create relayrunner-github-webhooks
wrangler queues create relayrunner-github-webhooks-dlq
```

Then deploy in this order, since each step binds to the one before it:

```sh
pnpm --filter @relayrunner/webhooks exec wrangler secret put GITHUB_WEBHOOK_SECRET
pnpm --filter @relayrunner/webhooks run deploy
pnpm --filter @relayrunner/api run deploy    # attaches the queue consumers
pnpm --filter @relayrunner/web run deploy    # forwards /api/webhooks/* here
```

The GitHub App's webhook URL doesn't change. It can also point straight at `https://relayrunner-webhooks.relayrun.workers.dev/api/webhooks/github`, which takes the dashboard Worker out of the path.
