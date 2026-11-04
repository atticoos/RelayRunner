# RelayRunner API

The gateway backend: a Hono app on a Cloudflare Worker. It serves everything under `/api`, so the dashboard in `apps/web` calls it same-origin.

| Route | What it does |
| --- | --- |
| `GET /api/health` | Liveness check. Touches neither auth nor D1. |
| `/api/auth/*` | [Better Auth](https://www.better-auth.com), with the GitHub App as its GitHub provider. |
| `GET /api/me` | The signed-in user, or `401`. |
| `/api/auth/organization/*` | Workspaces: Better Auth's organization plugin (create, list, set active). The creator is the owner. |
| `GET /api/workspaces/current` | The session's active workspace, the user's role in it, and its GitHub App installations. `401` signed out, `409 no_active_workspace` if none. |
| `GET /api/github/install` | Redirects to the GitHub App's install page with a signed `state` naming the active workspace ("Connect GitHub org"). |
| `GET /api/github/setup` | The App's Setup URL. Links `installation_id` to the workspace in `state`, but only if the user's GitHub token sees it in `GET /user/installations`. Redirects to `/workspace?github=<outcome>`. |
| `GET /api/github/installations/unclaimed` | Installations the user can see that no workspace has claimed (installed straight from GitHub). |
| `POST /api/github/installations/:id/claim` | Links an unclaimed installation to the active workspace, with the same token check. `409` if another workspace has it. |

GitHub webhooks don't come in over HTTP here. [`apps/webhooks`](../webhooks) verifies each delivery and puts it on the `relayrunner-github-webhooks` queue, and this Worker's `queue()` handler processes it (`src/webhook-queue.ts`). Failures retry with backoff for about half an hour, then move to `relayrunner-github-webhooks-dlq`, whose consumer logs the full message and acks it. `installation` and `installation_repositories` keep `github_installation` current (account, suspension, repository selection; `deleted` removes the row and its repos). They and `repository` events also keep `github_repository` current: the repos each installation can see, with name and visibility, so activity can be labeled by repo (`src/repositories.ts`). There's no repo opt-in: `runs-on: relayrunner` from a connected installation is the opt-in. `workflow_job` events for jobs with the `relayrunner` label are logged (`relayrunner job received`); others are ignored.

## Layout

- `src/app.ts` builds the Hono app. Routes after `attachSession` get `c.var.auth`, `c.var.user` and `c.var.session`. The auth instance is made per request because Workers only hand out bindings per request. Better Auth's cookie cache is on, so most session checks skip D1.
- Workspaces are Better Auth organizations stored under gateway names: `workspace`, `workspace_member`, `workspace_invitation` and `session.active_workspace_id` (mapped in `workspaces()` in `src/auth.ts`). The MVP caps membership at one (the owner), but the tables are shaped for teams. `github_installation` is keyed by the installation id with one nullable `workspace_id`, so a workspace connects many installations and each installation belongs to at most one workspace (null while unclaimed). Routes that act on a workspace go behind `requireWorkspace` (`src/middleware/workspace.ts`), which checks membership in D1.
- `src/db/schema.ts` is the Drizzle schema for D1. `pnpm db:generate` writes migrations into `migrations/`, and Wrangler applies them. See [Migrations](#migrations).
- `src/durable-objects/` holds stubs for the three Durable Objects: `PickRunner` (one per `pick` job), `Router` (one per repo) and `MachineLink` (one per laptop, holding the agent WebSocket). The working runner protocol client is in the PR #21 spike.

## Migrations

Change `src/db/schema.ts`, then run `pnpm db:generate`. Drizzle names the file with a UTC timestamp prefix (`20261104160202_workspaces.sql`), so two branches that each add a migration don't both claim `0002`. Don't use `wrangler d1 migrations create`, which numbers files and skips the Drizzle snapshot. `src/migrations.test.ts` fails on any file that isn't timestamp-prefixed or isn't in `migrations/meta/_journal.json`.

Merging to `main` applies new migrations to the production database: the `Apply D1 migrations` workflow runs `pnpm db:migrate:remote` with the `CLOUDFLARE_API_TOKEN` secret. It is the only thing that migrates production: the Workers Builds deploy (`pnpm run deploy:api`) does not. Migrations must be safe to run against the Worker that's already deployed, since the workflow can land before the new Worker does.

The first four migrations were renamed from `0000_init.sql`, `0001_workspaces.sql`, `0002_installation_repository_selection.sql` and `0003_installation_github_state_at.sql`. Wrangler tracks applied migrations by filename, so `db:migrate:local` and `db:migrate:remote` first run `scripts/rename-legacy-migrations.sql`, which renames those rows in `d1_migrations` and does nothing on a fresh database or once they're renamed. It can go once every database (including your local `.wrangler` state) has been migrated with it.

## Run it locally

```sh
cp .dev.vars.example .dev.vars   # fill in the GitHub App's OAuth client and a secret
pnpm db:migrate:local
pnpm dev                          # http://localhost:8787/api/health
```

## Deploy

`wrangler.jsonc` pins the RelayRunner Cloudflare account (`account_id`), so wrangler targets it even if your login can see other accounts. Then:

```sh
pnpm db:migrate:remote                   # the D1 Migrations workflow does this on merge to main; only needed by hand for a new database
wrangler secret put BETTER_AUTH_SECRET   # and GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET
pnpm run deploy:api                      # from the repo root; deploys only, no migrations
```

The browser never talks to this Worker directly: the dashboard Worker (`apps/web`) forwards `/api/*` here over a service binding, so `BETTER_AUTH_URL` (in `wrangler.jsonc` vars) is the dashboard's origin: `https://relayrunner-app.relayrun.workers.dev` until `app.relayrunner.dev` moves to this account. `.dev.vars` overrides it for local dev. Deploy this Worker before `apps/web`, since the binding needs it to exist. The GitHub App's callback URL is `<BETTER_AUTH_URL>/api/auth/callback/github` Its webhook URL points at the webhooks Worker (`apps/webhooks`), not this one.

### Sign-in on dashboard previews

Workers Builds previews of the dashboard (`<alias>-relayrunner-app.relayrun.workers.dev`) forward `/api/*` to this production Worker too, so a signed-in preview acts on production data. Better Auth's `oAuthProxy` plugin makes sign-in work there without another GitHub callback URL: GitHub always returns to `<BETTER_AUTH_URL>/api/auth/callback/github`, production exchanges the code and redirects to `<preview>/api/auth/callback/github/oauth-proxy` with the profile encrypted under `BETTER_AUTH_SECRET` (valid for 60 seconds), and the preview sets its own session cookie. Only origins matching `PREVIEW_ORIGINS` (wrangler vars) can start a proxied sign-in; any other host gets handed back to production. When the dashboard moves to `app.relayrunner.dev`, update `BETTER_AUTH_URL` and `PREVIEW_ORIGINS` together.
