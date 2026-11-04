import { api } from "@/lib/api";

/** A job RelayRunner routed, as GET /api/activity returns it. */
export type ActivityJob = {
  id: number;
  repository: string;
  /** null when the gateway hasn't mirrored the repo yet. */
  private: boolean | null;
  runId: number;
  runAttempt: number;
  workflow: string | null;
  name: string;
  /** The runner RelayRunner selected, e.g. "ubuntu-latest". */
  runner: string;
  /** The runner that took the job, e.g. "GitHub Actions 3". */
  runnerName: string | null;
  branch: string | null;
  sha: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** The job's page on GitHub. */
  url: string;
};

export type ActivityPage = { jobs: ActivityJob[]; nextBefore: number | null };

export function getActivity(before?: number) {
  return api<ActivityPage>(before === undefined ? "/activity" : `/activity?before=${before}`);
}

/** "3m ago", "2h ago", or a date for anything older than a day. */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** "45s", "3m 12s", or null when the job hasn't started. Runs to now while it's in progress. */
export function duration(job: Pick<ActivityJob, "startedAt" | "completedAt">, now = Date.now()) {
  if (!job.startedAt) return null;
  const end = job.completedAt ? Date.parse(job.completedAt) : now;
  const seconds = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
