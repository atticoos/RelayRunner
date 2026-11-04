// Routing a job to a machine, kept free of Durable Object APIs so it can be tested on its own.
//
// 1. A `runs-on: relayrunner` pick job is claimed by a PickRunner, which asks the workspace's
//    Router where the job's run should go. For a private repo with a free machine, the Router
//    records a route and answers its one-time label `rr-<route id>`; otherwise `ubuntu-latest`.
// 2. The workflow's next job runs on that label, so GitHub queues it as `runs-on: rr-<route id>`.
// 3. The `queued` webhook for that job claims the route (same repo, same run) and the machine's
//    MachineLink mints an org JIT runner on the label and sends the machine a `run` message.

export const FALLBACK_RUNNER = "ubuntu-latest";

export const ROUTE_LABEL_PREFIX = "rr-";
// 12 lowercase hex characters.
const ROUTE_LABEL = /^rr-([0-9a-f]{12})$/;

// How long a picked machine is held for its route's job before the hold lapses. The job is
// normally queued seconds after the pick finishes.
export const ROUTE_HOLD_MS = 10 * 60_000;
// How long a route is kept at all, so a redelivered webhook still finds it.
export const ROUTE_TTL_MS = 24 * 60 * 60_000;

export interface Route {
  id: string;
  machineId: string;
  machineName: string;
  installationId: number;
  // owner/name, and GitHub's repository id.
  repo: string;
  repositoryId: number;
  runId: number;
  createdAt: number;
  // reserved: answered by a pick, waiting for its job's `queued` webhook.
  // dispatched: the job was claimed and handed to the machine.
  // done: the machine reported the job started (its own status says busy from then on), or the
  // runner failed.
  state: "reserved" | "dispatched" | "done";
  // The job that claimed the route. Only that job can claim it again (a redelivery).
  jobId?: number;
}

export function newRouteId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const routeLabel = (routeId: string) => `${ROUTE_LABEL_PREFIX}${routeId}`;

/** The route id of the first `rr-<route id>` label, or null. GitHub labels ignore case. */
export function routeIdFromLabels(labels: string[]): string | null {
  for (const label of labels) {
    const match = ROUTE_LABEL.exec(label.toLowerCase());
    if (match) return match[1];
  }
  return null;
}

/** Whether a route still keeps its machine from being picked for another job. */
export function holdsMachine(route: Route, now: number) {
  return route.state !== "done" && now - route.createdAt < ROUTE_HOLD_MS;
}

export interface Candidate {
  id: string;
  name: string;
  online: boolean;
  state: "idle" | "busy" | null;
}

/** The first machine that is online, idle and not held by another route, or null. */
export function chooseMachine(candidates: Candidate[], held: Set<string>): Candidate | null {
  return (
    candidates.find(
      (machine) => machine.online && machine.state === "idle" && !held.has(machine.id),
    ) ?? null
  );
}

export interface QueuedJob {
  jobId: number;
  repositoryId: number;
  runId: number;
}

/** Whether a queued job may take a route: same repo and run, and not claimed by another job. */
export function canClaim(route: Route, job: QueuedJob) {
  if (route.repositoryId !== job.repositoryId || route.runId !== job.runId) return false;
  return route.jobId === undefined || route.jobId === job.jobId;
}

// GitHub runner names allow letters, digits, `.`, `-` and `_`. The machine's name comes first so
// the job's "Runner name" says which machine ran it; the route id keeps it unique in the org.
export function machineRunnerName(machineName: string, routeId: string) {
  const base =
    machineName
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "machine";
  return `${base}-${routeId}`;
}

// The parts of a claimed job's `github` context the Router needs.
export interface JobContext {
  repo: string;
  runId: number;
}

// The job message carries its expression contexts in `contextData`, as the runner's
// PipelineContextData JSON: a dictionary is {t: 2, d: [{k, v}]}, a string is a bare JSON string,
// and a number is {t: 4, n}. Returns null when `github.repository` or `github.run_id` is missing.
export function jobContext(contextData: unknown): JobContext | null {
  const github = dictionary(isRecord(contextData) ? contextData.github : undefined);
  if (!github) return null;
  const repo = scalar(github.get("repository"));
  const runId = Number(scalar(github.get("run_id")));
  if (typeof repo !== "string" || !repo.includes("/") || !Number.isSafeInteger(runId) || runId <= 0)
    return null;
  return { repo, runId };
}

function dictionary(value: unknown): Map<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.d)) return null;
  const entries = new Map<string, unknown>();
  for (const entry of value.d)
    if (isRecord(entry) && typeof entry.k === "string") entries.set(entry.k, entry.v);
  return entries;
}

function scalar(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if (isRecord(value)) {
    if (typeof value.s === "string") return value.s;
    if (typeof value.n === "number") return value.n;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
