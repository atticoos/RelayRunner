/**
 * Dashboard Worker. Serves the SPA from static assets and forwards /api/* to
 * the API Worker (apps/api) over a service binding, so the browser only ever
 * sees one origin. That keeps Better Auth cookies first-party on workers.dev
 * today and on app.relayrunner.dev later, without a route on the API Worker.
 * GitHub webhooks (/api/webhooks/*) go to the webhook ingress Worker
 * (apps/webhooks) instead, which queues them for the API.
 *
 * Development-only views (/dev/* and /api/dev/*) need a Cloudflare Access JWT
 * (see packages/access). They answer 404 wherever Access isn't configured,
 * which today means everywhere except preview URLs.
 *
 * `run_worker_first` in wrangler.jsonc sends /api/* and /dev/* here before the
 * assets layer; every other path is answered by assets (with the SPA fallback).
 */
import { gateDevOnly, isDevOnlyPath, type AccessEnv } from "@relayrunner/access";

interface Env extends AccessEnv {
  API: Fetcher;
  WEBHOOKS: Fetcher;
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/webhooks/")) {
      return env.WEBHOOKS.fetch(request);
    }
    if (isDevOnlyPath(pathname)) {
      const gate = await gateDevOnly(request, env);
      if ("response" in gate) return gate.response;
      // Who Access let in: lets an agent check its service token before it drives a dev view.
      if (pathname === "/dev/access") return Response.json({ identity: gate.identity });
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
