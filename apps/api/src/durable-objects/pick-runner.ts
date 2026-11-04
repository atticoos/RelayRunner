import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import { appJwt, DEFAULT_RUNNER_GROUP_ID, deleteOrgRunner, generateOrgJitConfig, importAppPrivateKey, installationToken } from '../github-app.ts';
import { latestRunnerVersion, RunnerClient, decodeJitConfig } from '../runner-protocol.ts';
import { RELAYRUNNER_LABEL } from '../webhook-queue.ts';

export interface PickWork {
  jobId: number;
  installationId: number;
  // owner/repo. The owner is the org the runner registers in.
  repo: string;
}

const POLL_TIMEOUT_MS = 60_000;
const WAIT_FOR_JOB_MS = 4 * 60_000;

// One per queued `pick` job, addressed by job id. Acts as a one-job runner: registers a JIT runner
// on the `relayrunner` label, claims a job, and reports the route as its `runner` output without
// running any steps. GitHub hands a runner any pending job with its label, so the job it claims
// may not be the one whose webhook started it; the route comes from the Router either way.
export class PickRunner extends DurableObject<Env> {
  // Idempotent: a redelivered or retried `queued` webhook for the same job does nothing.
  async start(work: PickWork): Promise<void> {
    if (await this.ctx.storage.get('started')) return;
    await this.ctx.storage.put({ started: true, work });
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const work = await this.ctx.storage.get<PickWork>('work');
    if (!work) return;
    await this.ctx.storage.delete('work');

    const org = work.repo.split('/')[0];
    const startedAt = Date.now();
    let outcome: Record<string, unknown> = { result: 'no-job' };
    let token: string | undefined;
    let runnerId: number | undefined;
    let client: RunnerClient | undefined;
    try {
      const key = await importAppPrivateKey(await this.env.GITHUB_APP_PRIVATE_KEY.get());
      token = await installationToken(await appJwt(this.env.GITHUB_APP_ID, key), work.installationId);
      const jit = await generateOrgJitConfig(token, org, {
        name: `relayrunner-pick-${work.jobId}`,
        labels: [RELAYRUNNER_LABEL],
        runnerGroupId: DEFAULT_RUNNER_GROUP_ID,
      });
      runnerId = jit.runnerId;

      client = new RunnerClient(decodeJitConfig(jit.encodedJitConfig), await latestRunnerVersion());
      await client.openSession();
      const request = await waitForJob(client);
      if (request) {
        const job = await client.claim(request);
        const runner = await this.env.ROUTER.getByName(work.repo).route({ jobId: work.jobId, name: job.message.jobDisplayName });
        await client.complete(job, 'succeeded', { runner });
        outcome = { result: 'routed', runner, claimedJob: job.message.jobDisplayName };
        runnerId = undefined; // GitHub removes a JIT runner once its job is done.
      }
    } catch (error) {
      outcome = { result: 'error', error: error instanceof Error ? error.message : String(error) };
    } finally {
      await client?.closeSession().catch(() => undefined);
      if (token && runnerId !== undefined) await deleteOrgRunner(token, org, runnerId).catch(() => undefined);
    }
    const log = outcome.result === 'error' ? console.error : console.log;
    log(JSON.stringify({ msg: 'relayrunner pick finished', jobId: work.jobId, repo: work.repo, installationId: work.installationId, ...outcome, durationMs: Date.now() - startedAt }));
  }
}

async function waitForJob(client: RunnerClient) {
  const deadline = Date.now() + WAIT_FOR_JOB_MS;
  while (Date.now() < deadline) {
    try {
      const request = await client.poll(AbortSignal.timeout(POLL_TIMEOUT_MS));
      if (request) return request;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'TimeoutError')) throw error;
    }
  }
  return null;
}
