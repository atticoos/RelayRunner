import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';

// One per queued `pick` job. Acts as a one-job runner: claims the job on GitHub and reports the
// route as its output without running steps. The working protocol client is in the PR #21 spike.
export class PickRunner extends DurableObject<Env> {
  async start(_work: { jobId: number; repo: string }): Promise<void> {
    throw new Error('PickRunner.start is not implemented yet.');
  }
}
