import { RouteWalk } from "@relayrunner/activity";
import { inArray } from "drizzle-orm";
import { recordEvent } from "./activity.ts";
import { type Db, schema } from "./db/index.ts";
import type { JobContext, RouteDecision } from "./routing.ts";

const table = schema.routeDecision;

// What a pick knew when it answered, for the Activity page.
export interface PickRecord {
  workspaceId: string;
  // GitHub's repository id, or null when RelayRunner can't see the repo.
  repositoryId: number | null;
  context: JobContext;
  // The relay job's name, e.g. "relay".
  jobName: string | null;
  // The Router's walk down the order, or null when the pick stopped before it.
  decision: RouteDecision | null;
  // Set when the relay failed: the message it failed with.
  reason: string | null;
}

/**
 * Keeps how a pick walked the runner order, so the run's jobs can say why they went where they did,
 * and logs a `job.unroutable` event when the relay failed. A redelivered pick for the same run
 * attempt keeps the first decision.
 */
export async function recordPick(db: Db, pick: PickRecord) {
  const { context, decision } = pick;
  if (decision && pick.repositoryId !== null)
    await db
      .insert(table)
      .values({
        workspaceId: pick.workspaceId,
        repositoryId: pick.repositoryId,
        runId: context.runId,
        runAttempt: context.runAttempt,
        step: decision.runner === null ? null : decision.step,
        runner: decision.runner,
        skipped: decision.skipped,
        notInOrder: decision.notInOrder,
        machine: context.machine,
        github: context.github,
        reason: decision.runner === null ? decision.reason : null,
      })
      .onConflictDoNothing();
  if (pick.reason !== null)
    await recordEvent(db, {
      workspaceId: pick.workspaceId,
      type: "job.unroutable",
      data: {
        repository: context.repo,
        runId: context.runId,
        runAttempt: context.runAttempt,
        workflow: context.workflow,
        job: pick.jobName,
        reason: pick.reason,
        walk: decision ? walkOf(decision, context) : null,
      },
    });
}

// The walk as the Activity page reads it.
function walkOf(decision: RouteDecision, context: JobContext): RouteWalk {
  return {
    step: decision.runner === null ? null : decision.step,
    skipped: decision.skipped,
    notInOrder: decision.notInOrder,
    machine: context.machine,
    github: context.github,
    sandbox: context.sandbox,
  };
}

type JobKey = { repositoryId: number; runId: number; runAttempt: number };

/**
 * The walk behind each job's run: the newest decision for the job's repo and run at or before the
 * job's attempt (a re-run of failed jobs reuses the earlier attempt's pick). Keyed by `key(job)`.
 */
export async function walksForJobs(db: Db, jobs: JobKey[]): Promise<Map<string, RouteWalk>> {
  const walks = new Map<string, RouteWalk>();
  const runIds = [...new Set(jobs.map((job) => job.runId))];
  if (runIds.length === 0) return walks;
  const rows = await db.select().from(table).where(inArray(table.runId, runIds));
  for (const job of jobs) {
    let best: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (row.repositoryId !== job.repositoryId || row.runId !== job.runId) continue;
      if (row.runAttempt > job.runAttempt) continue;
      if (!best || row.runAttempt > best.runAttempt) best = row;
    }
    if (!best) continue;
    const parsed = RouteWalk.safeParse({
      step: best.step,
      skipped: best.skipped,
      notInOrder: best.notInOrder,
      machine: best.machine,
      github: best.github,
    });
    if (parsed.success) walks.set(jobKey(job), parsed.data);
  }
  return walks;
}

export const jobKey = (job: JobKey) => `${job.repositoryId}:${job.runId}:${job.runAttempt}`;
