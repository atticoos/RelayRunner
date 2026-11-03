import { runnerLabel } from './runner.ts';
import { api, SetupError } from './system.ts';
import type { Repository } from './workflows.ts';

interface Job {
  id: number;
  runner_name: string | null;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

function totals() {
  return { jobs: 0, succeeded: 0, failed: 0, other: 0, runtimeSeconds: 0, untimedJobs: 0 };
}

export function reportDays(value = '30') {
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days < 1 || days > 365) {
    throw new SetupError('USAGE', '--days must be an integer from 1 to 365.');
  }
  return days;
}

export function usageReport(target: Repository, days: number) {
  const label = runnerLabel(target);
  if (!label) throw new SetupError('RUNNER_STATE', 'No RunnerDuty runner is configured on this machine for this repository.');

  const until = new Date();
  const since = new Date(until.getTime() - days * 86_400_000);
  const actions = `repos/${target.repo}/actions`;
  const created = encodeURIComponent(`${since.toISOString()}..${until.toISOString()}`);
  const pagination = ['--paginate', '--slurp'];
  const pages = api<{ total_count: number; workflow_runs: { id: number; name: string; workflow_id: number }[] }[]>(
    `${actions}/runs?per_page=100&created=${created}`, pagination);
  if (pages.some(page => page.total_count >= 1000)) {
    throw new SetupError('REPORT_LIMIT', 'The window reached GitHub’s workflow run search limit. Retry with fewer days.');
  }

  const runs = new Map(pages.flatMap(page => page.workflow_runs.map(run => [run.id, run] as const)));
  const seenJobs = new Set<number>();
  const workflows = new Map<number, { name: string } & ReturnType<typeof totals>>();
  const total = totals();
  for (const run of runs.values()) {
    const jobs = api<{ jobs: Job[] }[]>(`${actions}/runs/${run.id}/jobs?per_page=100&filter=all`, pagination);
    for (const job of jobs.flatMap(page => page.jobs)) {
      if (job.runner_name !== label || job.status !== 'completed' || seenJobs.has(job.id)) continue;
      seenJobs.add(job.id);
      const workflow = workflows.get(run.workflow_id) ?? { name: run.name, ...totals() };
      workflows.set(run.workflow_id, workflow);
      const outcome = job.conclusion === 'success' ? 'succeeded' : job.conclusion === 'failure' ? 'failed' : 'other';
      const duration = Date.parse(job.completed_at ?? '') - Date.parse(job.started_at ?? '');
      for (const counts of [total, workflow]) {
        counts.jobs++;
        counts[outcome]++;
        if (Number.isFinite(duration) && duration >= 0) counts.runtimeSeconds += duration / 1000;
        else counts.untimedJobs++;
      }
    }
  }
  return {
    repo: target.repo,
    runner: label,
    since: since.toISOString(),
    until: until.toISOString(),
    runsScanned: runs.size,
    ...total,
    estimatedHostedMinutesSaved: total.runtimeSeconds / 60,
    workflows: [...workflows].map(([id, counts]) => ({ id, ...counts }))
      .sort((a, b) => b.runtimeSeconds - a.runtimeSeconds || a.id - b.id),
  };
}
