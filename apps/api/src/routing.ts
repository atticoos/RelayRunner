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
  // The machine's runner labels (machineLabels).
  labels: string[];
}

// GitHub's default self-hosted runner labels, so a job's `runs-on` list can be copied into the
// relay's `machine` input as-is.
const OS_LABELS: Record<string, string> = { linux: "Linux", macos: "macOS", windows: "Windows" };
const ARCH_LABELS: Record<string, string> = { x64: "X64", arm64: "ARM64", arm: "ARM" };

/** A machine's labels from its stored os and arch: `self-hosted`, then OS and arch when known. */
export function machineLabels(machine: { os: string | null; arch: string | null }): string[] {
  const labels = ["self-hosted"];
  const os = machine.os ? OS_LABELS[machine.os] : undefined;
  const arch = machine.arch ? ARCH_LABELS[machine.arch] : undefined;
  if (os) labels.push(os);
  if (arch) labels.push(arch);
  return labels;
}

/** A relay input's labels: comma-separated, trimmed, empties dropped. */
export function parseLabels(input: unknown): string[] {
  if (typeof input !== "string") return [];
  return input
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
}

/** Whether a machine has every wanted label, ignoring case as GitHub does. */
export function hasLabels(machine: string[], wanted: string[]) {
  const have = new Set(machine.map((label) => label.toLowerCase()));
  return wanted.every((label) => have.has(label.toLowerCase()));
}

/** When each machine was last picked: the newest route per machine. */
export function lastPicked(routes: Route[]): Map<string, number> {
  const picked = new Map<string, number>();
  for (const route of routes) {
    const previous = picked.get(route.machineId);
    if (previous === undefined || route.createdAt > previous)
      picked.set(route.machineId, route.createdAt);
  }
  return picked;
}

/**
 * Of the machines with every wanted label, the online, idle one no route holds that was least
 * recently picked, or null. Machines never picked come first; ties keep the candidates' order.
 * No wanted labels means none is required; a job that names no machine labels doesn't get here.
 */
export function chooseMachine(
  candidates: Candidate[],
  held: Set<string>,
  picked: Map<string, number> = new Map(),
  wanted: string[] = [],
): Candidate | null {
  let best: Candidate | null = null;
  let bestAt = Infinity;
  for (const machine of candidates) {
    if (!machine.online || machine.state !== "idle" || held.has(machine.id)) continue;
    if (!hasLabels(machine.labels, wanted)) continue;
    const at = picked.get(machine.id) ?? -Infinity;
    if (at < bestAt) {
      best = machine;
      bestAt = at;
    }
  }
  return best;
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

// What the Router needs from a claimed job: its repo and run from the `github` context, and the
// relay's per-provider inputs from `inputs`.
export interface JobContext {
  repo: string;
  runId: number;
  // Labels a machine must all have. Empty when the relay's `machine` input is left out or empty:
  // the job doesn't use machines.
  machine: string[];
  // The GitHub-hosted runner label(s) from the relay's `github` input. Empty when left out.
  github: string[];
}

// The job message carries its expression contexts in `contextData`, as the runner's
// PipelineContextData JSON: a dictionary is {t: 2, d: [{k, v}]}, a string is a bare JSON string,
// and a number is {t: 4, n}. Returns null when `github.repository` or `github.run_id` is missing.
// Missing `inputs` (a relay older than per-provider inputs) reads as no labels.
export function jobContext(contextData: unknown): JobContext | null {
  const github = dictionary(isRecord(contextData) ? contextData.github : undefined);
  if (!github) return null;
  const repo = scalar(github.get("repository"));
  const runId = Number(scalar(github.get("run_id")));
  if (typeof repo !== "string" || !repo.includes("/") || !Number.isSafeInteger(runId) || runId <= 0)
    return null;
  const inputs = dictionary(isRecord(contextData) ? contextData.inputs : undefined);
  return {
    repo,
    runId,
    machine: parseLabels(scalar(inputs?.get("machine"))),
    github: parseLabels(scalar(inputs?.get("github"))),
  };
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
