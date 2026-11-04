/**
 * Dashboard Worker. Serves the SPA from static assets and forwards /api/* to
 * the API Worker (apps/api) over a service binding, so the browser only ever
 * sees one origin. That keeps Better Auth cookies first-party on workers.dev
 * today and on app.relayrunner.dev later, without a route on the API Worker.
 *
 * `run_worker_first` in wrangler.jsonc sends /api/* here before the assets
 * layer; every other path is answered by assets (with the SPA fallback).
 */
interface Env {
  API: Fetcher;
  ASSETS: Fetcher;
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return env.API.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
