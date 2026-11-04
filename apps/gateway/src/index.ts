import { DurableObject } from 'cloudflare:workers';
import { decodeJitConfig, latestRunnerVersion, RunnerClient } from './protocol.ts';
import { constantTimeEqual, queuedJobId, validSignature } from './webhook.ts';

interface Env {
  ADMIN_TOKEN: string;
  GITHUB_REPOSITORY: string;
  PICK_RUNNER: DurableObjectNamespace<PickRunner>;
  ROUTER: DurableObjectNamespace<Router>;
  RUNNER_LABEL: string;
  WEBHOOK_SECRET: string;
}

interface PickEvent {
  at?: string;
  jobId: number;
  result: 'routed' | 'no-job' | 'error' | 'no-runner-config';
  runner?: string;
  durationMs?: number;
  error?: string;
}

const defaultRunner = 'ubuntu-latest';
const pollTimeoutMs = 60_000;
const waitForJobMs = 4 * 60_000;
const maxEvents = 100;

// Holds the route and the one-job runner configs. A real service would mint configs on demand
// with a GitHub App and decide from configured providers.
export class Router extends DurableObject<Env> {
  async addRunnerConfig(config: string) {
    const configs = await this.ctx.storage.get<string[]>('configs') ?? [];
    await this.ctx.storage.put('configs', [...configs, config]);
    return configs.length + 1;
  }

  async takeRunnerConfig() {
    const [config, ...rest] = await this.ctx.storage.get<string[]>('configs') ?? [];
    await this.ctx.storage.put('configs', rest);
    return config;
  }

  async setRoute(runner: string) {
    await this.ctx.storage.put('route', runner);
  }

  async route() {
    return await this.ctx.storage.get<string>('route') ?? defaultRunner;
  }

  async record(event: PickEvent) {
    const events = await this.ctx.storage.get<PickEvent[]>('pickEvents') ?? [];
    await this.ctx.storage.put('pickEvents', [...events, { at: new Date().toISOString(), ...event }].slice(-maxEvents));
  }

  async report() {
    return {
      route: await this.route(),
      runnerConfigs: (await this.ctx.storage.get<string[]>('configs') ?? []).length,
      events: await this.ctx.storage.get<PickEvent[]>('pickEvents') ?? [],
    };
  }
}

// Acts as a one-job runner: it claims a job on the gateway's label and reports the route as the
// job's output without running any steps. GitHub assigns any job with a matching label, so this
// may not be the job from the webhook that started it.
export class PickRunner extends DurableObject<Env> {
  async start(work: { config: string; jobId: number }) {
    await this.ctx.storage.put('work', work);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const work = await this.ctx.storage.get<{ config: string; jobId: number }>('work');
    if (!work) return;
    await this.ctx.storage.delete('work');

    const router = this.env.ROUTER.getByName('main');
    const startedAt = Date.now();
    let client: RunnerClient | undefined;
    let event: PickEvent = { jobId: work.jobId, result: 'no-job' };
    try {
      client = new RunnerClient(decodeJitConfig(work.config), await latestRunnerVersion());
      await client.openSession();
      const request = await waitForJob(client);
      if (request) {
        const job = await client.claim(request);
        const runner = await router.route();
        await client.complete(job, 'succeeded', { runner: JSON.stringify(runner) });
        event = { ...event, result: 'routed', runner };
      }
    } catch (error) {
      event = { ...event, result: 'error', error: error instanceof Error ? error.message : String(error) };
    } finally {
      await client?.closeSession().catch(() => undefined);
      await router.record({ ...event, durationMs: Date.now() - startedAt });
    }
  }
}

async function waitForJob(client: RunnerClient) {
  const deadline = Date.now() + waitForJobMs;
  while (Date.now() < deadline) {
    try {
      const request = await client.poll(AbortSignal.timeout(pollTimeoutMs));
      if (request) return request;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'TimeoutError')) throw error;
    }
  }
  return null;
}

async function handleWebhook(request: Request, env: Env) {
  const body = await request.text();
  if (!await validSignature(env.WEBHOOK_SECRET, body, request.headers.get('x-hub-signature-256'))) {
    return new Response('Invalid signature.', { status: 401 });
  }
  if (request.headers.get('x-github-event') !== 'workflow_job') return new Response(null, { status: 202 });

  const jobId = queuedJobId(JSON.parse(body), env.GITHUB_REPOSITORY, env.RUNNER_LABEL);
  if (jobId === null) return new Response(null, { status: 202 });

  const router = env.ROUTER.getByName('main');
  const config = await router.takeRunnerConfig();
  if (!config) {
    await router.record({ jobId, result: 'no-runner-config' });
    return new Response(null, { status: 202 });
  }
  await env.PICK_RUNNER.getByName(String(jobId)).start({ config, jobId });
  return new Response(null, { status: 202 });
}

async function handleAdmin(request: Request, env: Env, pathname: string) {
  if (!constantTimeEqual(request.headers.get('authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`)) {
    return new Response('Unauthorized.', { status: 401 });
  }
  const router = env.ROUTER.getByName('main');
  if (pathname === '/admin/report') return Response.json(await router.report());
  if (request.method === 'POST' && pathname === '/admin/runner-configs') {
    return Response.json({ runnerConfigs: await router.addRunnerConfig(await request.text()) });
  }
  if (request.method === 'POST' && pathname === '/admin/route') {
    const { runner } = await request.json() as { runner: string };
    await router.setRoute(runner);
    return Response.json({ route: runner });
  }
  return new Response('Not found.', { status: 404 });
}

export default {
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/webhook' && request.method === 'POST') return handleWebhook(request, env);
    if (pathname.startsWith('/admin/')) return handleAdmin(request, env, pathname);
    return new Response('Not found.', { status: 404 });
  },
};
