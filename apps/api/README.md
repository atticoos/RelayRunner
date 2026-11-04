# RelayRunner API

The gateway backend: a Hono app on a Cloudflare Worker. It serves everything under `/api`, so the dashboard in `apps/web` calls it same-origin.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Liveness check. Touches neither auth nor D1. |
| `/api/auth/*` | [Better Auth](https://www.better-auth.com), with the GitHub App as its GitHub provider. |
| `GET /api/me` | The signed-in user, or `401`. |
| `/api/auth/organization/*` | Workspaces: Better Auth's organization plugin (create, list, set active). The creator is the owner. |
| `GET /api/workspaces/current` | The session's active workspace, the user's role in it, and its GitHub App installations. `401` signed out, `409 no_active_workspace` if none. |

GitHub webhooks don't come in over HTTP here. [`apps/webhooks`](../webhooks) verifies each delivery and puts it on the `relayrunner-github-webhooks` queue, and this Worker's `queue()` handler processes it (`src/webhook-queue.ts`). Failures retry with backoff for about half an hour, then move to `relayrunner-github-webhooks-dlq`, whose consumer logs the full message and acks it. Processing is still only a log line.

## Layout

- `src/app.ts` builds the Hono app. Routes after `attachSession` get `c.var.auth`, `c.var.user` and `c.var.session`. The auth instance is made per request because Workers only hand out bindings per request. Better Auth's cookie cache is on, so most session checks skip D1.
- Workspaces are Better Auth organizations stored under gateway names: `workspace`, `workspace_member`, `workspace_invitation` and `session.active_workspace_id` (mapped in `workspaces()` in `src/auth.ts`). The MVP caps membership at one (the owner), but the tables are shaped for teams. `github_installation` is keyed by the installation id with one nullable `workspace_id`, so a workspace connects many installations and each installation belongs to at most one workspace (null while unclaimed). Routes that act on a workspace go behind `requireWorkspace` (`src/middleware/workspace.ts`), which checks membership in D1.
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
wrangler secret put BETTER_AUTH_SECRET   # and GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET
pnpm run deploy:api                      # from the repo root; D1 migrations apply separately (pnpm db:migrate:remote)
```

The browser never talks to this Worker directly: the dashboard Worker (`apps/web`) forwards `/api/*` here over a service binding, so `BETTER_AUTH_URL` (in `wrangler.jsonc` vars) is the dashboard's origin: `https://relayrunner-app.relayrun.workers.dev` until `app.relayrunner.dev` moves to this account. `.dev.vars` overrides it for local dev. Deploy this Worker before `apps/web`, since the binding needs it to exist. The GitHub App's callback URL is `<BETTER_AUTH_URL>/api/auth/callback/github` and its webhook URL is `<BETTER_AUTH_URL>/api/webhooks/github`, which the dashboard Worker forwards to `apps/webhooks`.
