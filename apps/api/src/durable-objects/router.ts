import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';

// One per repository, addressed by `owner/repo`. Holds the repo's ordered runner list and decides
// where each job goes: pinned, autopilot (idle laptop, then Blacksmith, then hosted), or off.
export class Router extends DurableObject<Env> {
  async route(_job: { jobId: number; name: string }): Promise<string> {
    return 'ubuntu-latest';
  }
}
