# RelayRunner API

The gateway backend: a Hono app on a Cloudflare Worker. It serves everything under `/api`, so the dashboard in `apps/web` calls it same-origin.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Liveness check. Touches neither auth nor D1. |
| `POST /api/webhooks/github` | GitHub App webhooks, verified with `GITHUB_WEBHOOK_SECRET`. Logs each delivery (event, action, delivery id, repo) and answers `ping` with `200`, everything else `202`. No processing yet. |
| `/api/auth/*` | [Better Auth](https://www.better-auth.com), with the GitHub App as its GitHub provider. |
| `GET /api/me` | The signed-in user, or `401`. |
| `/api/auth/organization/*` | Workspaces: Better Auth's organization plugin (create, list, set active). The creator is the owner. |
| `GET /api/workspaces/current` | The session's active workspace, the user's role in it, and its GitHub App installations. `401` signed out, `409 no_active_workspace` if none. |

## Layout

- `src/app.ts` builds the Hono app. Routes after `attachSession` get `c.var.auth`, `c.var.user` and `c.var.session`. The auth instance is made per request because Workers only hand out bindings per request. Better Auth's cookie cache is on, so most session checks skip D1.
- Workspaces are Better Auth organizations stored under gateway names: `workspace`, `workspace_member`, `workspace_invitation` and `session.active_workspace_id` (mapped in `workspaces()` in `src/auth.ts`). The MVP caps membership at one (the owner), but the tables are shaped for teams. `github_installation` is keyed by the installation id with one nullable `workspace_id`, so a workspace connects many installations and each installation belongs to at most one workspace (null while unclaimed). Routes that act on a workspace go behind `requireWorkspace` (`src/middleware/workspace.ts`), which checks membership in D1.
- `src/db/schema.ts` is the Drizzle schema for D1. `pnpm db:generate` writes migrations into `migrations/`, and Wrangler applies them. See [Migrations](#migrations).
- `src/durable-objects/` holds stubs for the three Durable Objects: `PickRunner` (one per `pick` job), `Router` (one per repo) and `MachineLink` (one per laptop, holding the agent WebSocket). The working runner protocol client is in the PR #21 spike.

## Migrations

Change `src/db/schema.ts`, then run `pnpm db:generate`. Drizzle names the file with a UTC timestamp prefix (`20261104160202_workspaces.sql`), so two branches that each add a migration don't both claim `0002`. Don't use `wrangler d1 migrations create`, which numbers files and skips the Drizzle snapshot. `src/migrations.test.ts` fails on any file that isn't timestamp-prefixed or isn't in `migrations/meta/_journal.json`.

Merging to `main` applies new migrations to the production database: the Workers Builds deploy runs `pnpm db:migrate:remote` before `wrangler deploy`. Keep that deploy command going through `db:migrate:remote` (not a bare `wrangler d1 migrations apply`) so the legacy rename below runs first.

The first two migrations were renamed from `0000_init.sql` and `0001_workspaces.sql`. Wrangler tracks applied migrations by filename, so `db:migrate:local` and `db:migrate:remote` first run `scripts/rename-legacy-migrations.sql`, which renames those rows in `d1_migrations` and does nothing on a fresh database or once they're renamed. It can go once every database (including your local `.wrangler` state) has been migrated with it.

## Run it locally

```sh
cp .dev.vars.example .dev.vars   # fill in the GitHub App's OAuth client and a secret
pnpm db:migrate:local
pnpm dev                          # http://localhost:8787/api/health
```

## Deploy

`wrangler.jsonc` pins the RelayRunner Cloudflare account (`account_id`), so wrangler targets it even if your login can see other accounts. Then:

```sh
pnpm db:migrate:remote                   # Workers Builds does this on merge to main; only needed by hand for a new database
wrangler secret put BETTER_AUTH_SECRET   # and GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_WEBHOOK_SECRET
pnpm run deploy
```

The browser never talks to this Worker directly: the dashboard Worker (`apps/web`) forwards `/api/*` here over a service binding, so `BETTER_AUTH_URL` (in `wrangler.jsonc` vars) is the dashboard's origin: `https://relayrunner-app.relayrun.workers.dev` until `app.relayrunner.dev` moves to this account. `.dev.vars` overrides it for local dev. Deploy this Worker before `apps/web`, since the binding needs it to exist. The GitHub App's callback URL is `<BETTER_AUTH_URL>/api/auth/callback/github` and its webhook URL is `<BETTER_AUTH_URL>/api/webhooks/github`.
