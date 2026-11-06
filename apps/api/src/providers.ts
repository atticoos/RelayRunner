// Runner providers: compute that runs a routed job on a one-job (JIT) runner the gateway mints.
// Local machines get their runner over MachineLink's WebSocket. A provider is anything else that
// can take the same JIT config, through this contract:
//
// - launch: start a runner for one route. The gateway has already minted the JIT config on the
//   route's `rr-<id>` label, so the provider never needs GitHub credentials.
// - lifecycle: the gateway learns started and finished from the job's own `workflow_job`
//   webhooks (in_progress, completed), so a provider doesn't report them.
// - cancel: stop whatever is left of a route's runner. Called when its job completes, and safe
//   to call when nothing is running.
//
// Capacity is the gateway's: the Router counts a workspace's live sandbox routes. The first
// provider is the Cloudflare Sandbox spike (spikes/sandbox-provider), bound as SANDBOX.

import type { Env } from "./env.ts";
import {
  appJwt,
  DEFAULT_RUNNER_GROUP_ID,
  generateOrgJitConfig,
  importAppPrivateKey,
  installationToken,
} from "./github-app.ts";
import { routeLabel, type Route, type SandboxSize } from "./routing.ts";

export interface LaunchRequest {
  // The route id, which names the provider's instance.
  routeId: string;
  // The label the job is queued on, and the runner's only label.
  label: string;
  jitConfig: string;
  runnerId: number;
  size: SandboxSize;
}

export interface LaunchResult {
  // How long the provider took to accept the launch.
  startMs: number;
}

/** What a runner provider implements. The sandbox spike's service binding is one. */
export interface RunnerProvider {
  launch(request: LaunchRequest): Promise<LaunchResult>;
  cancel(routeId: string): Promise<void>;
}

/** Mints an org JIT runner on a route's label, named `<prefix>-<route id>`. */
export async function mintRouteRunner(env: Env, route: Route, prefix: string) {
  const appKey = await importAppPrivateKey(await env.GITHUB_APP_PRIVATE_KEY.get());
  const token = await installationToken(
    await appJwt(env.GITHUB_APP_ID, appKey),
    route.installationId,
  );
  return generateOrgJitConfig(token, route.repo.split("/")[0], {
    name: `${prefix}-${route.id}`,
    labels: [routeLabel(route.id)],
    runnerGroupId: DEFAULT_RUNNER_GROUP_ID,
  });
}

/**
 * Starts a claimed sandbox route's runner: marks the route launched (only the first `queued`
 * delivery gets past this), mints the runner, and asks the provider to start it. A failure
 * unmarks the route and throws, so the webhook's retry tries again.
 */
export async function launchSandbox(
  env: Env,
  workspaceId: string,
  route: Route,
): Promise<"launched" | "already_launched" | "unavailable"> {
  const provider = env.SANDBOX;
  if (!provider) return "unavailable";
  const router = env.ROUTER.getByName(workspaceId);
  if (!(await router.markLaunched(route.id))) return "already_launched";
  try {
    const mintedAt = Date.now();
    const jit = await mintRouteRunner(env, route, "sandbox");
    const mintMs = Date.now() - mintedAt;
    const { startMs } = await provider.launch({
      routeId: route.id,
      label: routeLabel(route.id),
      jitConfig: jit.encodedJitConfig,
      runnerId: jit.runnerId,
      size: route.size === undefined ? "4x12" : (route.size as SandboxSize),
    });
    console.log(
      JSON.stringify({
        msg: "relayrunner sandbox launched",
        routeId: route.id,
        repo: route.repo,
        runId: route.runId,
        jobId: route.jobId,
        size: route.size,
        runnerId: jit.runnerId,
        mintMs,
        startMs,
      }),
    );
    return "launched";
  } catch (error) {
    await router.markLaunched(route.id, false);
    throw error;
  }
}
