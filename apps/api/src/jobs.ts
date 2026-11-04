import type { WebhookMessage } from "@relayrunner/github-webhooks";
import { and, desc, eq, isNull, lt, type SQL, sql } from "drizzle-orm";
import { type Db, schema } from "./db/index.ts";
import { findInstallation } from "./installations.ts";
import { routeIdFromLabels } from "./routing.ts";

type WorkflowJobMessage = Extract<WebhookMessage, { event: "workflow_job" }>;

const table = schema.workflowJob;

// How far along a status is. GitHub's pre-queue states ('requested', 'waiting', 'pending') count as
// queued. A row only moves to an equal or higher rank, so an unordered or retried delivery never
// rewinds it.
const rank = (status: SQL) =>
  sql`(case ${status} when 'completed' then 2 when 'in_progress' then 1 else 0 end)`;

/**
 * Records a workflow_job delivery for the Activity page. A `pick` job (it asked for the relayrunner
 * label) is always stored and marks its run as routed. Any other job is stored only when its run
 * already has a pick. Returns whether anything was written.
 *
 * Skipped when the installation has no row yet (its webhook hasn't arrived, or it was uninstalled).
 * A later event for the same job writes it, since each one carries the job's full state.
 */
export async function recordWorkflowJob(
  db: Db,
  message: WorkflowJobMessage,
  isPick: boolean,
): Promise<boolean> {
  const { installationId, job, repository } = message;
  if (!installationId || !(await findInstallation(db, installationId))) return false;
  // Matched on run id alone, so a re-run of failed jobs (a new attempt that reuses the earlier
  // attempt's pick output) still counts as routed.
  if (!isPick && !(await runHasPick(db, job.runId))) return false;

  const row = {
    id: job.id,
    installationId,
    repositoryId: repository.id,
    repositoryFullName: repository.fullName,
    runId: job.runId,
    runAttempt: job.runAttempt,
    kind: isPick ? ("pick" as const) : ("job" as const),
    workflowName: job.workflowName,
    name: job.name,
    labels: job.labels,
    headBranch: job.headBranch,
    headSha: job.headSha,
    status: job.status,
    conclusion: job.conclusion,
    runnerName: job.runnerName,
    githubCreatedAt: parseDate(job.createdAt) ?? new Date(message.receivedAt),
    startedAt: parseDate(job.startedAt),
    completedAt: parseDate(job.completedAt),
  };
  await db
    .insert(table)
    .values(row)
    .onConflictDoUpdate({
      target: table.id,
      set: {
        repositoryFullName: sql`excluded.repository_full_name`,
        workflowName: sql`excluded.workflow_name`,
        name: sql`excluded.name`,
        labels: sql`excluded.labels`,
        status: sql`excluded.status`,
        conclusion: sql`excluded.conclusion`,
        runnerName: sql`coalesce(excluded.runner_name, ${table.runnerName})`,
        startedAt: sql`coalesce(excluded.started_at, ${table.startedAt})`,
        completedAt: sql`coalesce(excluded.completed_at, ${table.completedAt})`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`${rank(sql`${table.status}`)} <= ${rank(sql`excluded.status`)}`,
    });
  return true;
}

/**
 * Notes which machine a route sent a job to. Only fills an empty machine_id, so a redelivered
 * webhook never moves a job to another machine. A job that wasn't stored (no pick in its run) is
 * left alone.
 */
export async function setJobMachine(db: Db, jobId: number, machineId: string) {
  await db
    .update(table)
    .set({ machineId })
    .where(and(eq(table.id, jobId), isNull(table.machineId)));
}

async function runHasPick(db: Db, runId: number) {
  const [pick] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.runId, runId), eq(table.kind, "pick")))
    .limit(1);
  return Boolean(pick);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const ACTIVITY_PAGE_SIZE = 50;

/**
 * The workspace's routed jobs, newest first: the real work jobs, not the pick jobs that routed
 * them. `before` is a job id from a previous page. GitHub job ids increase over time, so ordering
 * by id is ordering by when the job was created.
 */
export async function listActivity(db: Db, workspaceId: string, before?: number) {
  const rows = await db
    .select({
      job: table,
      private: schema.githubRepository.private,
      machineName: schema.machine.name,
    })
    .from(table)
    .innerJoin(schema.githubInstallation, eq(schema.githubInstallation.id, table.installationId))
    .leftJoin(schema.githubRepository, eq(schema.githubRepository.id, table.repositoryId))
    .leftJoin(schema.machine, eq(schema.machine.id, table.machineId))
    .where(
      and(
        eq(schema.githubInstallation.workspaceId, workspaceId),
        eq(table.kind, "job"),
        before === undefined ? undefined : lt(table.id, before),
      ),
    )
    .orderBy(desc(table.id))
    .limit(ACTIVITY_PAGE_SIZE + 1);
  const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
  return {
    jobs: page.map(({ job, private: isPrivate, machineName }) =>
      presentJob(job, isPrivate, machineName),
    ),
    nextBefore: rows.length > ACTIVITY_PAGE_SIZE ? page[page.length - 1].job.id : null,
  };
}

export type ActivityJob = ReturnType<typeof presentJob>;

/**
 * Where RelayRunner sent a job. A job on a route's `rr-<id>` label went to a machine: `name` is the
 * machine's current name, or null before the route is claimed or once the machine is deleted. Any
 * other job ran on the GitHub label the pick answered, such as `ubuntu-latest`. The `rr-` label
 * itself is never shown: it's a one-time id, not a runner.
 */
export type ActivityRunner =
  | { type: "machine"; machineId: string | null; name: string | null }
  | { type: "github"; label: string };

function presentRunner(job: typeof table.$inferSelect, machineName: string | null): ActivityRunner {
  if (job.machineId || routeIdFromLabels(job.labels))
    return { type: "machine", machineId: job.machineId, name: machineName };
  return { type: "github", label: job.labels.join(", ") };
}

function presentJob(
  job: typeof table.$inferSelect,
  isPrivate: boolean | null,
  machineName: string | null,
) {
  return {
    id: job.id,
    repository: job.repositoryFullName,
    // null when the repo isn't mirrored (yet).
    private: isPrivate,
    runId: job.runId,
    runAttempt: job.runAttempt,
    workflow: job.workflowName,
    name: job.name,
    // Where RelayRunner sent the job: GitHub resolved its runs-on to the pick's answer.
    runner: presentRunner(job, machineName),
    runnerName: job.runnerName,
    branch: job.headBranch,
    sha: job.headSha,
    status: job.status,
    conclusion: job.conclusion,
    createdAt: job.githubCreatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    url: `https://github.com/${job.repositoryFullName}/actions/runs/${job.runId}/job/${job.id}`,
  };
}
