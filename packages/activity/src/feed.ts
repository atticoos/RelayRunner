import type { ActivityEvent, RouteWalk } from "./events.ts";

// GET /api/activity's response. Types only: the API builds it, the dashboard reads it.

/**
 * Where RelayRunner sent a job. A job on a route's `rr-<id>` label went to a machine: `name` is the
 * machine's current name, or null before the route is claimed or once the machine is deleted. Any
 * other job ran on the GitHub label the pick answered, such as `ubuntu-latest`.
 */
export type ActivityRunner =
  | { type: "machine"; machineId: string | null; name: string | null }
  | { type: "github"; label: string };

/** A routed job's current state. */
export interface ActivityJob {
  id: number;
  repository: string;
  /** null when the gateway hasn't mirrored the repo yet. */
  private: boolean | null;
  runId: number;
  runAttempt: number;
  workflow: string | null;
  name: string;
  runner: ActivityRunner;
  /** How the run's pick walked the runner order, or null for jobs routed before it was recorded. */
  walk: RouteWalk | null;
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
  /** The job's run on GitHub. */
  runUrl: string;
}

/** One entry in the log. `job` is set for job events, `machine` for machine events. */
export type ActivityItem = ActivityEvent & {
  id: number;
  occurredAt: string;
  /** The user who did it, or null for things RelayRunner or a machine did on their own. */
  actor: { id: string; name: string } | null;
  /** The machine's current name, falling back to its name at the time. */
  machine: { id: string | null; name: string } | null;
  job: ActivityJob | null;
  /**
   * For a `job.unroutable` relay: the run's jobs that needed it and so never ran, by name, in the
   * order GitHub created them. Empty until GitHub reports them skipped. Their own job rows are left
   * out of the log, since this entry already says they couldn't run.
   */
  jobsNotRun?: string[];
};

export interface ActivityPage {
  items: ActivityItem[];
  /** Pass as `before` for the next older page; null on the last page. */
  nextBefore: number | null;
}
