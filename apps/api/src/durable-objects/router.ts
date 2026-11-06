import { readRunnerOrder } from "@relayrunner/runner-order";
import { DurableObject } from "cloudflare:workers";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import type { Env } from "../env.ts";
import {
  canClaim,
  chooseMachine,
  decideRoute,
  holdsMachine,
  holdsSandbox,
  isSandboxRoute,
  SANDBOX_CAPACITY,
  sandboxSize,
  type SandboxPick,
  machineLabels,
  lastPicked,
  newRouteId,
  pausedMatches,
  routeLabel,
  ROUTE_TTL_MS,
  type Candidate,
  type MachinePick,
  type QueuedJob,
  type Route,
  type RouteDecision,
} from "../routing.ts";

export interface PickedJob {
  workspaceId: string;
  installationId: number;
  repositoryId: number;
  repo: string;
  runId: number;
  // Labels a machine must all have (the relay's `machine` input). Empty: don't use machines.
  machine: string[];
  // The GitHub-hosted label(s) (the relay's `github` input). Empty: don't use GitHub-hosted.
  github: string[];
  // The relay's `sandbox` input. Empty: don't use sandboxes.
  sandbox: string[];
  // Public repos never go to a machine: anyone could run code on it with a pull request.
  private: boolean;
}

const ROUTE_KEY = "route:";

// One per workspace, addressed by workspace id. Decides where each picked job's run goes and
// keeps the routes it hands out (src/routing.ts), so the job queued on a route's label can find
// its machine.
export class Router extends DurableObject<Env> {
  /**
   * Where the run's next job goes, walking the workspace's runner order: a machine route's
   * `rr-<id>`, the job's own `github` label, or no runner and the reason.
   */
  async route(job: PickedJob): Promise<RouteDecision> {
    const db = createDb(this.env.DB);
    const [workspace] = await db
      .select({ runnerOrder: schema.workspace.runnerOrder })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, job.workspaceId))
      .limit(1);
    return decideRoute(
      readRunnerOrder(workspace?.runnerOrder),
      job,
      () => this.pickMachine(job),
      () => this.pickSandbox(job),
    );
  }

  // A sandbox route while the workspace has a free slot (SANDBOX_CAPACITY), "busy" when it
  // doesn't, or "unavailable" when no provider is bound. The container itself starts when the
  // route's job is queued (webhook-queue dispatchRoute).
  private pickSandbox(job: PickedJob): Promise<SandboxPick> {
    if (!this.env.SANDBOX) return Promise.resolve("unavailable");
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const running = (await this.routes(now)).filter((route) => holdsSandbox(route, now));
      if (running.length >= SANDBOX_CAPACITY) return "busy";
      const route: Route = {
        id: newRouteId(),
        provider: "sandbox",
        machineId: "",
        machineName: "sandbox",
        installationId: job.installationId,
        repo: job.repo,
        repositoryId: job.repositoryId,
        runId: job.runId,
        createdAt: now,
        state: "reserved",
        size: sandboxSize(job.sandbox),
      };
      await this.ctx.storage.put(ROUTE_KEY + route.id, route);
      return routeLabel(route.id);
    });
  }

  // A route to a free machine with the job's labels, the paused machines when every one with the
  // labels is paused, or null.
  private pickMachine(job: PickedJob): Promise<MachinePick> {
    // One decision at a time, so two picks can't both see the same machine as free.
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const routes = await this.routes(now);
      const held = new Set(routes.filter((r) => holdsMachine(r, now)).map((r) => r.machineId));

      const machines = await createDb(this.env.DB)
        .select({
          id: schema.machine.id,
          name: schema.machine.name,
          os: schema.machine.os,
          arch: schema.machine.arch,
          pausedAt: schema.machine.pausedAt,
        })
        .from(schema.machine)
        .where(
          and(
            eq(schema.machine.workspaceId, job.workspaceId),
            isNotNull(schema.machine.tokenHash),
            isNull(schema.machine.revokedAt),
          ),
        );
      const pool = machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        labels: machineLabels(machine),
        paused: machine.pausedAt !== null,
      }));
      // Paused machines can't be picked, so there's no need to ask for their live status.
      const candidates: Candidate[] = await Promise.all(
        pool
          .filter((machine) => !held.has(machine.id) && !machine.paused)
          .map(async (machine) => ({
            ...machine,
            ...(await this.env.MACHINE_LINK.getByName(machine.id).status()),
          })),
      );
      const machine = chooseMachine(candidates, held, lastPicked(routes), job.machine);
      if (!machine) {
        const paused = pausedMatches(pool, job.machine);
        return paused.length > 0 ? { paused } : null;
      }

      const route: Route = {
        id: newRouteId(),
        machineId: machine.id,
        machineName: machine.name,
        installationId: job.installationId,
        repo: job.repo,
        repositoryId: job.repositoryId,
        runId: job.runId,
        createdAt: now,
        state: "reserved",
      };
      await this.ctx.storage.put(ROUTE_KEY + route.id, route);
      return routeLabel(route.id);
    });
  }

  /**
   * The route a queued `rr-<id>` job may run on, or null when the label is unknown, expired, or
   * belongs to another repo, run or job, or once the machine has taken the job. Claiming again with the same job returns the route again,
   * so a redelivered webhook can retry the hand-off.
   */
  async claim(routeId: string, job: QueuedJob): Promise<Route | null> {
    const route = await this.ctx.storage.get<Route>(ROUTE_KEY + routeId);
    if (!route || route.state === "done" || Date.now() - route.createdAt > ROUTE_TTL_MS)
      return null;
    if (!canClaim(route, job)) return null;
    const claimed: Route = {
      ...route,
      jobId: job.jobId,
      state: route.state === "reserved" ? "dispatched" : route.state,
    };
    await this.ctx.storage.put(ROUTE_KEY + routeId, claimed);
    return claimed;
  }

  /**
   * The machine a route sent `job` to, without claiming anything: for the Activity page, when a
   * job's later webhooks arrive before (or without) its `queued` one. Null when the route is
   * unknown, expired, or belongs to another repo, run or job.
   */
  async machineFor(routeId: string, job: QueuedJob): Promise<string | null> {
    const route = await this.ctx.storage.get<Route>(ROUTE_KEY + routeId);
    if (!route || Date.now() - route.createdAt > ROUTE_TTL_MS || !canClaim(route, job)) return null;
    return route.machineId;
  }

  /**
   * When `job` ran on a sandbox route, marks the route done (freeing its slot) and returns true.
   * False for a machine route or an unknown one.
   */
  async sandboxDone(routeId: string, job: QueuedJob): Promise<boolean> {
    const route = await this.ctx.storage.get<Route>(ROUTE_KEY + routeId);
    if (!route || !isSandboxRoute(route) || !canClaim(route, job)) return false;
    if (route.state !== "done")
      await this.ctx.storage.put(ROUTE_KEY + routeId, { ...route, state: "done" });
    return true;
  }

  /**
   * Marks a sandbox route launched. False when it already was, so a redelivered `queued` webhook
   * doesn't start a second container. `launched: false` undoes it after a failed launch.
   */
  async markLaunched(routeId: string, launched = true): Promise<boolean> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const route = await this.ctx.storage.get<Route>(ROUTE_KEY + routeId);
      if (!route) return false;
      if (launched && route.launchedAt) return false;
      await this.ctx.storage.put(ROUTE_KEY + routeId, {
        ...route,
        launchedAt: launched ? Date.now() : undefined,
      });
      return true;
    });
  }

  /** Stops a route holding its machine. MachineLink calls this when the machine reports in. */
  async release(routeId: string): Promise<void> {
    const route = await this.ctx.storage.get<Route>(ROUTE_KEY + routeId);
    if (route && route.state !== "done")
      await this.ctx.storage.put(ROUTE_KEY + routeId, { ...route, state: "done" });
  }

  // Every route still kept, after dropping the expired ones.
  private async routes(now: number) {
    const stored = await this.ctx.storage.list<Route>({ prefix: ROUTE_KEY });
    const expired = [...stored].filter(([, r]) => now - r.createdAt > ROUTE_TTL_MS).map(([k]) => k);
    // delete() takes at most 128 keys at a time.
    if (expired.length) await this.ctx.storage.delete(expired.slice(0, 128));
    return [...stored.values()].filter((r) => now - r.createdAt <= ROUTE_TTL_MS);
  }
}
