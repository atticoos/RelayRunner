# Cloudflare Access

Cloudflare Access keeps dashboard preview URLs and development-only views private, while agents get in with a service token instead of a browser login.

## What is protected

| Hostname                                                            | Access          | Why                                                                           |
| ------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `<alias>-relayrunner-app.relayrun.workers.dev` (dashboard previews) | Yes, whole host | Previews run unreviewed code against production data.                         |
| `relayrunner-app.relayrun.workers.dev` (dashboard)                  | No              | It is the live dashboard until `app.relayrunner.dev` moves to this account.   |
| `relayrunner-webhooks.relayrun.workers.dev`                         | No              | GitHub posts webhooks here and can't log in. The signature check protects it. |
| `relayrunner-api.relayrun.workers.dev`                              | No              | Nothing calls it directly; the dashboard reaches it over a service binding.   |

The API and webhooks Workers set `"preview_urls": false`, so they have no preview hostnames to protect.

## Development-only views

Paths under `/dev` and `/api/dev` on the dashboard Worker are development-only. `packages/access` checks the `Cf-Access-Jwt-Assertion` JWT that Access adds to each request it lets through:

- If `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset, the path returns 404. This is the state on the production `workers.dev` host.
- If the JWT is missing or invalid, the path returns 403 with a `reason`.
- If the JWT is valid, the request continues. `GET /dev/access` returns the caller's identity, either a person's email or a service token's Client ID.

The Worker checks the JWT in addition to the Access edge check. If the Access app is removed or misconfigured, these paths stay closed.

To add a dev-only view, put its page under `/dev/` and its data under `/api/dev/`. The API Worker's own `workers.dev` URL is public. An `/api/dev/*` route in `apps/api` must call `gateDevOnly` itself, and must not trust a header set by the dashboard Worker.

## One-time setup

The team domain is `relayrunner.cloudflareaccess.com`.

1. **Protect the preview URLs.** In Workers & Pages, open `relayrunner-app`. Go to Settings > Domains & Routes > Preview URLs and turn on Cloudflare Access. This creates an Access application for the previews.
2. **Copy the AUD.** In Zero Trust > Access > Applications, open that application and copy its Application Audience (AUD) tag. Put it in `previews.vars.ACCESS_AUD` in `apps/web/wrangler.jsonc`. The AUD is not a secret.
3. **Choose who can log in.** Add a login method (GitHub, or One-time PIN). Then edit the application's Allow policy to include the people who need previews.
4. **Create the agent service token.** In Zero Trust > Access > Service credentials, create a token named `relayrunner-agents`. Save the Client ID and Client Secret right away, because the secret is shown only once. Add a second policy to the preview application with the action **Service Auth** that includes this token.
5. **Deploy** `api`, `webhooks` and `web` so that the `preview_urls` settings apply.

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

## After the custom domain moves

When `app.relayrunner.dev` serves the dashboard, add a self-hosted Access application for the paths `app.relayrunner.dev/dev` and `app.relayrunner.dev/api/dev`, with the same two policies. Add its AUD to the top-level `vars.ACCESS_AUD`, comma-separated if there is more than one. Dev views then work in production for allowed people and agents, and stay 404 for everyone else.
