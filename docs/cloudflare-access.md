# Cloudflare Access

Cloudflare Access keeps dashboard preview URLs and development-only views private, while agents get in with a service token instead of a browser login.

## What is protected

| Hostname                                                                | Access          | Why                                                                                         |
| ----------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `<alias>-relayrunner-app.relayrun.workers.dev` (dashboard previews)     | Yes, whole host | Previews run unreviewed code against production data.                                       |
| `relayrunner-app.relayrun.workers.dev` (dashboard)                      | No              | It is the live dashboard until `app.relayrunner.dev` moves to this account.                 |
| `app.relayrunner.app` (dashboard, interim custom domain)                | Only `/dev`     | Same Worker as above. `/dev` and `/api/dev` sit behind the `relayrunner-app dev views` app. |
| `relayrunner-webhooks.relayrun.workers.dev`, `webhooks.relayrunner.app` | No              | GitHub posts webhooks here and can't log in. The signature check protects it.               |
| `relayrunner-api.relayrun.workers.dev`, `api.relayrunner.app`           | No              | The dashboard reaches it over a service binding. `/api/dev/*` checks the Access JWT itself. |

The API and webhooks Workers set `"preview_urls": false`, so they have no preview hostnames to protect.

## Development-only views

Paths under `/dev` and `/api/dev` on the dashboard Worker are development-only. `packages/access` checks the `Cf-Access-Jwt-Assertion` JWT that Access adds to each request it lets through:

- If `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset, the path returns 404.
- If the JWT is missing or invalid, the path returns 403 with a `reason`. This is what happens on the production `workers.dev` host, which has no Access app to add a JWT.
- If the JWT is valid, the request continues. `GET /dev/access` returns the caller's identity, either a person's email or a service token's Client ID.

The Worker checks the JWT in addition to the Access edge check. If the Access app is removed or misconfigured, these paths stay closed.

To add a dev-only view, put its page under `/dev/` and its data under `/api/dev/`. The API Worker's own `workers.dev` URL is public. An `/api/dev/*` route in `apps/api` must call `gateDevOnly` itself, and must not trust a header set by the dashboard Worker.

## Webhook dead letters

`/dev/webhooks` is the first dev view. It lists GitHub webhook deliveries that failed every retry and reached `relayrunner-github-webhooks-dlq`, with Replay and Discard buttons and a bulk replay by event or repository. The API's DLQ consumer archives each one to the R2 bucket `relayrunner-webhook-dead-letters` as `YYYY/MM/DD/<delivery-id>.json`, and acks only after that write succeeds. A lifecycle rule deletes objects after 30 days. The archive is in R2, not D1, because D1 failing is the likeliest reason a delivery dead-letters.

Agents can call the API directly through a preview host with the service token:

| Route                                            | What it does                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `GET /api/dev/webhooks/dead-letters`             | Newest first. `?cursor=` takes the `nextCursor` of the last page; `?event=` and `?repository=` filter.           |
| `POST /api/dev/webhooks/dead-letters/:id/replay` | Sends the original message, with its delivery ID, back to the main queue, then deletes the dead letter.          |
| `POST /api/dev/webhooks/dead-letters/replay`     | Bulk replay of up to 100 dead letters matching a JSON body of `{ "event", "repository" }`. A filter is required. |
| `DELETE /api/dev/webhooks/dead-letters/:id`      | Discards one.                                                                                                    |

Previews share the production API, so replaying from a preview acts on production. Fix the cause first, then replay what failed. An hourly cron logs `webhook dead letters rising` when `DEAD_LETTER_ALERT_THRESHOLD` (10) or more land in an hour, and posts to `DEAD_LETTER_ALERT_WEBHOOK_URL` if that secret is set.

## Account setup

All of this is already set up in the RelayRunner Zero Trust organization (team domain `relayrunner.cloudflareaccess.com`). Look in Zero Trust > Access to find each item.

- **Application** `relayrunner-app previews`: self-hosted, with the domain `*-relayrunner-app.relayrun.workers.dev` and 24-hour sessions. Its AUD tag is in `previews.vars.ACCESS_AUD` in `apps/web/wrangler.jsonc`.
- **Application** `relayrunner-app dev views`: self-hosted, with the destinations `app.relayrunner.app/dev` and `app.relayrunner.app/api/dev`, 24-hour sessions, and the same login methods and policies. Its AUD is the second entry of `vars.ACCESS_AUD` in `apps/web/wrangler.jsonc` and `apps/api/wrangler.jsonc`.
- **Login methods**: GitHub (the `RelayRunner Cloudflare` OAuth app in the relayrunner org), Cloudflare login (limited to members of the RelayRunner account), and One-time PIN.
- **Policy** `RelayRunner team` (Allow): members of the `relayrunner` GitHub org, plus the team's email addresses as a fallback. Adding someone to the GitHub org gives them access.
- **Policy** `RelayRunner agents` (Service Auth): the `relayrunner-agents` service token. The token expires after one year.

To rebuild the setup, create the application with the same domain and attach both policies, then copy the new AUD into `wrangler.jsonc`. Also copy it into `vars.ACCESS_AUD` in `apps/api/wrangler.jsonc`, which checks the same JWT on `/api/dev/*`. Deploy `api`, `webhooks` and `web` so that the `preview_urls` settings apply.

## Agent access

Store the token where agents read their environment, and never in the repository:

```sh
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
```

Send both headers with every request:

```sh
curl -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     https://<alias>-relayrunner-app.relayrun.workers.dev/dev/access
```

For a browser, such as Playwright, set the headers as `extraHTTPHeaders` on the context. Access then sets a `CF_Authorization` cookie for the host.

To rotate the token, create a new one, add it to the Service Auth policy, update the agents, and then revoke the old token.

## Custom domains

The dashboard serves `app.relayrunner.app` now, as an interim domain while `relayrunner.dev` waits out its transfer lock, and will serve `app.relayrunner.dev` after that. `relayrunner-app dev views` covers `app.relayrunner.app`. For each new host, add a destination to that app, or add a self-hosted Access application for the paths `<host>/dev` and `<host>/api/dev`, with the same two policies. Add any new AUD to the top-level `vars.ACCESS_AUD` in both `apps/web/wrangler.jsonc` and `apps/api/wrangler.jsonc`, separated by a comma from the AUDs already there. Dev views then work in production for allowed people and agents.
