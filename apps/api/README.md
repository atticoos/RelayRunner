# RelayRunner API

The gateway backend: a Hono app on a Cloudflare Worker. It serves everything under `/api`, so the dashboard in `apps/web` calls it same-origin.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Liveness check. Touches neither auth nor D1. |
| `POST /api/webhooks/github` | GitHub App webhooks, verified with `GITHUB_WEBHOOK_SECRET`. Stubbed: answers `202`. |
| `/api/auth/*` | [Better Auth](https://www.better-auth.com), with the GitHub App as its GitHub provider. |
| `GET /api/me` | The signed-in user, or `401`. |

## Layout

- `src/app.ts` builds the Hono app. Routes after `attachSession` get `c.var.auth`, `c.var.user` and `c.var.session`. The auth instance is made per request because Workers only hand out bindings per request. Better Auth's cookie cache is on, so most session checks skip D1.
- `src/db/schema.ts` is the Drizzle schema for D1. `pnpm db:generate` writes migrations into `migrations/`, and Wrangler applies them.
- `src/durable-objects/` holds stubs for the three Durable Objects: `PickRunner` (one per `pick` job), `Router` (one per repo) and `MachineLink` (one per laptop, holding the agent WebSocket). The working runner protocol client is in the PR #21 spike.

## Run it locally

```sh
cp .dev.vars.example .dev.vars   # fill in the GitHub App's OAuth client and a secret
pnpm db:migrate:local
pnpm dev                          # http://localhost:8787/api/health
```

## Deploy

`wrangler.jsonc` pins the RelayRunner Cloudflare account (`account_id`), so wrangler targets it even if your login can see other accounts. Then:

```sh
wrangler d1 create relayrunner    # paste the id into wrangler.jsonc
pnpm db:migrate:remote
wrangler secret put BETTER_AUTH_SECRET   # and GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET
pnpm deploy --var BETTER_AUTH_URL:https://app.relayrunner.dev
```

The browser never talks to this Worker directly: the dashboard Worker (`apps/web`) forwards `/api/*` here over a service binding, so `BETTER_AUTH_URL` is the dashboard's origin. Until `app.relayrunner.dev` is set up, use the dashboard's workers.dev URL (`https://relayrunner-app.<subdomain>.workers.dev`). Deploy this Worker before `apps/web`, since the binding needs it to exist. The GitHub App's callback URL is `<BETTER_AUTH_URL>/api/auth/callback/github`.
