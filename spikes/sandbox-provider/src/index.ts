// Spike: Cloudflare Containers as a RelayRunner runner provider (step 1, before the gateway).
//
// A workflow in relayrunner/relayrunner-ci-tests asks this Worker, with its GitHub OIDC token, to
// launch one sandbox per job. For each job the Worker mints an org JIT runner on the label
// `rr-sb-<run id>-<job>` and starts a container (a SandboxRunner Durable Object, named by that
// label) that runs `run.sh --jitconfig`. The job's `runs-on` names the same label. When the
// runner exits the container ends; a hard limit destroys it regardless. The workflow's last job
// calls /cleanup, which destroys anything left and removes runners that never got a job.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  DEFAULT_RUNNER_GROUP_ID,
  appJwt,
  deleteOrgRunner,
  generateOrgJitConfig,
  importAppPrivateKey,
  installationToken,
} from "../../../apps/api/src/github-app.ts";

interface Env {
  SANDBOX_RUNNER: DurableObjectNamespace<SandboxRunner>;
  GITHUB_APP_PRIVATE_KEY: SecretsStoreSecret;
  GITHUB_APP_ID: string;
  SPIKE_ORG: string;
  SPIKE_REPOSITORY: string;
  OIDC_AUDIENCE: string;
}

// A container is destroyed after this long whatever it is doing. rr-test jobs take minutes.
const HARD_LIMIT_MS = 30 * 60_000;
const ALARM_EVERY_MS = 30_000;

const IMAGES = ["runner", "dind"] as const;
type Image = (typeof IMAGES)[number];

// Instance sizes to compare. "4x12" is the largest custom size (4 vCPU, 12 GiB, 20 GB);
// standard-2 is 1 vCPU, 6 GiB, 12 GB.
const SIZES = {
  "4x12": { vcpu: 4, memoryMib: 12_288, diskMb: 20_000 },
  "2x8": { vcpu: 2, memoryMib: 8_192, diskMb: 16_000 },
  "standard-2": "standard-2",
} as const;
type Size = keyof typeof SIZES;

interface LaunchJob {
  name: string;
  image?: Image;
  size?: Size;
}

interface RunnerState {
  label: string;
  image: Image;
  size: Size;
  runnerId: number;
  requestedAt: number;
  startedAt?: number;
  exitedAt?: number;
  outcome?: "exited" | "error" | "hard-limit" | "cleanup";
  error?: string;
}

const log = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...fields }));

export class SandboxRunner extends DurableObject<Env> {
  private get container() {
    const container = this.ctx.container;
    if (!container) throw new Error("The container binding is not configured");
    return container;
  }

  async launch(input: {
    label: string;
    jitConfig: string;
    runnerId: number;
    image: Image;
    size: Size;
  }): Promise<RunnerState> {
    if (this.container.running) throw new Error(`${input.label} is already running`);
    const state: RunnerState = {
      label: input.label,
      image: input.image,
      size: input.size,
      runnerId: input.runnerId,
      requestedAt: Date.now(),
    };
    this.container.start({
      image: this.container.images[input.image],
      enableInternet: true,
      env: { JIT_CONFIG: input.jitConfig },
      instance: SIZES[input.size],
    });
    state.startedAt = Date.now();
    await this.ctx.storage.put("state", state);
    // Without this the container would stop after the default inactivity timeout, mid-job: the
    // runner talks to GitHub, never to this Durable Object.
    await this.container.setInactivityTimeout(HARD_LIMIT_MS).catch((error) => {
      log("inactivity-timeout-failed", { label: input.label, error: String(error) });
    });
    await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
    this.ctx.waitUntil(this.watch());
    log("launched", { ...state, startMs: state.startedAt! - state.requestedAt });
    return state;
  }

  private async watch() {
    let outcome: RunnerState["outcome"] = "exited";
    let error: string | undefined;
    try {
      await this.container.monitor();
    } catch (caught) {
      outcome = "error";
      error = String(caught);
    }
    await this.finish(outcome, error);
  }

  private async finish(outcome: NonNullable<RunnerState["outcome"]>, error?: string) {
    const state = await this.ctx.storage.get<RunnerState>("state");
    if (!state || state.exitedAt) return;
    state.exitedAt = Date.now();
    state.outcome = outcome;
    if (error) state.error = error;
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.deleteAlarm();
    log("finished", { ...state, lifetimeMs: state.exitedAt - state.requestedAt });
  }

  async alarm() {
    const state = await this.ctx.storage.get<RunnerState>("state");
    if (!state || state.exitedAt) return;
    if (!this.container.running) return this.finish("exited");
    if (Date.now() - state.requestedAt > HARD_LIMIT_MS) {
      await this.container.destroy().catch(() => {});
      return this.finish("hard-limit");
    }
    await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
  }

  /** Destroy the container if it's still up. Returns the state and whether it had to stop it. */
  async stop(): Promise<{ state: RunnerState | undefined; stopped: boolean }> {
    const stopped = this.container.running;
    if (stopped) {
      await this.container.destroy().catch(() => {});
      await this.finish("cleanup");
    }
    return { state: await this.ctx.storage.get<RunnerState>("state"), stopped };
  }

  async status() {
    return {
      state: await this.ctx.storage.get<RunnerState>("state"),
      running: this.container.running,
    };
  }
}

// --- GitHub OIDC: only workflow runs in SPIKE_REPOSITORY may launch sandboxes. ---

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";

interface OidcClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  repository: string;
  run_id: string;
  run_attempt: string;
}

const base64UrlDecode = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function verifyOidc(request: Request, env: Env): Promise<OidcClaims> {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new HttpError(401, "Missing bearer token");
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) throw new HttpError(401, "Malformed token");
  const { kid, alg } = JSON.parse(new TextDecoder().decode(base64UrlDecode(header)));
  if (alg !== "RS256") throw new HttpError(401, "Unexpected alg");
  const jwks = (await (await fetch(`${OIDC_ISSUER}/.well-known/jwks`)).json()) as {
    keys: (JsonWebKey & { kid: string })[];
  };
  const jwk = jwks.keys.find((key) => key.kid === kid);
  if (!jwk) throw new HttpError(401, "Unknown key");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlDecode(signature),
    new TextEncoder().encode(`${header}.${payload}`),
  );
  if (!valid) throw new HttpError(401, "Bad signature");
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as OidcClaims;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== OIDC_ISSUER) throw new HttpError(401, "Wrong issuer");
  if (!audiences.includes(env.OIDC_AUDIENCE)) throw new HttpError(401, "Wrong audience");
  if (claims.exp * 1000 < Date.now()) throw new HttpError(401, "Expired");
  if (claims.repository !== env.SPIKE_REPOSITORY) throw new HttpError(403, "Wrong repository");
  return claims;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function orgToken(env: Env) {
  const key = await importAppPrivateKey(await env.GITHUB_APP_PRIVATE_KEY.get());
  const jwt = await appJwt(env.GITHUB_APP_ID, key);
  const response = await fetch(`https://api.github.com/orgs/${env.SPIKE_ORG}/installation`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${jwt}`,
      "user-agent": "relayrunner-sandbox-spike",
    },
  });
  if (!response.ok) throw new Error(`GET /orgs/${env.SPIKE_ORG}/installation: ${response.status}`);
  const { id } = (await response.json()) as { id: number };
  return installationToken(jwt, id);
}

// Job names become part of a label, so keep them to what a label allows.
const JOB_NAME = /^[a-z0-9-]{1,40}$/;
const labelFor = (claims: OidcClaims, job: string) => `rr-sb-${claims.run_id}-${job}`;

async function readJobs(request: Request): Promise<LaunchJob[]> {
  const body = (await request.json().catch(() => null)) as { jobs?: LaunchJob[] } | null;
  const jobs = body?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > 8)
    throw new HttpError(400, "Send 1 to 8 jobs");
  for (const job of jobs) {
    if (!JOB_NAME.test(job.name)) throw new HttpError(400, `Bad job name ${job.name}`);
    if (job.image && !IMAGES.includes(job.image))
      throw new HttpError(400, `Bad image ${job.image}`);
    if (job.size && !(job.size in SIZES)) throw new HttpError(400, `Bad size ${job.size}`);
  }
  return jobs;
}

async function launch(request: Request, env: Env) {
  const claims = await verifyOidc(request, env);
  const jobs = await readJobs(request);
  const token = await orgToken(env);
  const results = await Promise.all(
    jobs.map(async (job) => {
      const label = labelFor(claims, job.name);
      const mintedAt = Date.now();
      const jit = await generateOrgJitConfig(token, env.SPIKE_ORG, {
        name: label,
        labels: [label],
        runnerGroupId: DEFAULT_RUNNER_GROUP_ID,
      });
      const mintMs = Date.now() - mintedAt;
      const state = await env.SANDBOX_RUNNER.getByName(label).launch({
        label,
        jitConfig: jit.encodedJitConfig,
        runnerId: jit.runnerId,
        image: job.image ?? "runner",
        size: job.size ?? "4x12",
      });
      return {
        label,
        runnerId: jit.runnerId,
        mintMs,
        startCallMs: state.startedAt! - state.requestedAt,
      };
    }),
  );
  log("launch", { runId: claims.run_id, results });
  return Response.json({ runId: claims.run_id, results });
}

async function cleanup(request: Request, env: Env) {
  const claims = await verifyOidc(request, env);
  const jobs = await readJobs(request);
  const token = await orgToken(env);
  const results = await Promise.all(
    jobs.map(async (job) => {
      const label = labelFor(claims, job.name);
      const { state, stopped } = await env.SANDBOX_RUNNER.getByName(label).stop();
      // A JIT runner that ran its job removes itself; this removes one that never got one.
      if (state) await deleteOrgRunner(token, env.SPIKE_ORG, state.runnerId).catch(() => {});
      return { label, stopped, state };
    }),
  );
  log("cleanup", { runId: claims.run_id, results });
  return Response.json({ runId: claims.run_id, results });
}

async function status(request: Request, env: Env) {
  const claims = await verifyOidc(request, env);
  const jobs = await readJobs(request);
  const results = await Promise.all(
    jobs.map(async (job) => {
      const label = labelFor(claims, job.name);
      return { label, ...(await env.SANDBOX_RUNNER.getByName(label).status()) };
    }),
  );
  return Response.json({ runId: claims.run_id, results });
}

/**
 * Step 2: the gateway's runner provider (apps/api/src/providers.ts), over a service binding. The
 * gateway mints the JIT config and owns routing and capacity; this only starts and stops
 * containers. Each route gets its own SandboxRunner, named by the route's label.
 */
export class SandboxProvider extends WorkerEntrypoint<Env> {
  async launch(request: {
    routeId: string;
    label: string;
    jitConfig: string;
    runnerId: number;
    size: string;
  }): Promise<{ startMs: number }> {
    const size: Size = request.size in SIZES ? (request.size as Size) : "4x12";
    const state = await this.env.SANDBOX_RUNNER.getByName(request.label).launch({
      label: request.label,
      jitConfig: request.jitConfig,
      runnerId: request.runnerId,
      image: "dind",
      size,
    });
    return { startMs: state.startedAt! - state.requestedAt };
  }

  /** Destroys the route's container if it's still up, and removes its runner if it never ran. */
  async cancel(routeId: string): Promise<void> {
    const { state, stopped } = await this.env.SANDBOX_RUNNER.getByName(`rr-${routeId}`).stop();
    if (state && stopped)
      await deleteOrgRunner(await orgToken(this.env), this.env.SPIKE_ORG, state.runnerId).catch(
        () => {},
      );
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (request.method === "POST" && pathname === "/launch") return await launch(request, env);
      if (request.method === "POST" && pathname === "/cleanup") return await cleanup(request, env);
      if (request.method === "POST" && pathname === "/status") return await status(request, env);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof HttpError) return new Response(error.message, { status: error.status });
      log("error", { pathname, error: String(error) });
      return new Response(String(error), { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
