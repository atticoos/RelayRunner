import {
  ActivityEvent,
  type ActivityFilter,
  type ActivityItem,
  type ActivityPage,
  type DisconnectReason,
  type RouteWalk,
} from "@relayrunner/activity";
import { and, desc, eq, like, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { type Db, schema } from "./db/index.ts";
import { presentJob } from "./jobs.ts";
import { jobKey, walksForJobs } from "./route-decisions.ts";

const table = schema.activityEvent;

export type NewActivityEvent = ActivityEvent & {
  workspaceId: string;
  machineId?: string | null;
  jobId?: number | null;
  actorUserId?: string | null;
  occurredAt?: Date;
};

/**
 * Appends an event to the workspace's Activity log. `data` is checked against its type's schema,
 * so a bad event throws here instead of breaking the page later. A job's event is written at most
 * once per type: a repeat (a redelivered webhook) is ignored.
 */
export async function recordEvent(db: Db, event: NewActivityEvent) {
  const { type, data } = ActivityEvent.parse({ type: event.type, data: event.data });
  await db
    .insert(table)
    .values({
      workspaceId: event.workspaceId,
      type,
      data,
      machineId: event.machineId ?? null,
      jobId: event.jobId ?? null,
      actorUserId: event.actorUserId ?? null,
      occurredAt: event.occurredAt ?? new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Logs a machine event in the machine's workspace, with the machine's current name. Does nothing
 * if the machine row is gone.
 */
export async function recordMachineEvent(
  db: Db,
  machineId: string,
  event:
    | { type: "machine.connected"; data: { runnerVersion: string | null } }
    | { type: "machine.disconnected"; data: { reason: DisconnectReason } },
) {
  const [machine] = await db
    .select({ workspaceId: schema.machine.workspaceId, name: schema.machine.name })
    .from(schema.machine)
    .where(eq(schema.machine.id, machineId))
    .limit(1);
  if (!machine) return;
  // recordEvent checks the assembled data against the type's schema.
  await recordEvent(db, {
    workspaceId: machine.workspaceId,
    machineId,
    type: event.type,
    data: { machineName: machine.name, ...event.data },
  } as NewActivityEvent);
}

export const ACTIVITY_PAGE_SIZE = 50;

const eventMachine = alias(schema.machine, "event_machine");
const jobMachine = alias(schema.machine, "job_machine");

/**
 * The workspace's Activity log, newest first. `before` is an event id from a previous page.
 * `filter` keeps one kind of event ('job', 'machine' or 'member').
 */
export async function listActivity(
  db: Db,
  workspaceId: string,
  { before, filter }: { before?: number; filter?: ActivityFilter } = {},
): Promise<ActivityPage> {
  const job = schema.workflowJob;
  const rows = await db
    .select({
      event: table,
      actorName: schema.user.name,
      eventMachineName: eventMachine.name,
      job,
      jobMachineName: jobMachine.name,
      private: schema.githubRepository.private,
    })
    .from(table)
    .leftJoin(schema.user, eq(schema.user.id, table.actorUserId))
    .leftJoin(eventMachine, eq(eventMachine.id, table.machineId))
    .leftJoin(job, eq(job.id, table.jobId))
    .leftJoin(jobMachine, eq(jobMachine.id, job.machineId))
    .leftJoin(schema.githubRepository, eq(schema.githubRepository.id, job.repositoryId))
    .where(
      and(
        eq(table.workspaceId, workspaceId),
        before === undefined ? undefined : lt(table.id, before),
        filter === undefined ? undefined : like(table.type, `${filter}.%`),
      ),
    )
    .orderBy(desc(table.id))
    .limit(ACTIVITY_PAGE_SIZE + 1);
  const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
  const walks = await walksForJobs(
    db,
    page.flatMap((row) => (row.job ? [row.job] : [])),
  );
  return {
    items: page.flatMap((row) => {
      const item = presentEvent(row, row.job ? (walks.get(jobKey(row.job)) ?? null) : null);
      return item ? [item] : [];
    }),
    nextBefore: rows.length > ACTIVITY_PAGE_SIZE ? page[page.length - 1].event.id : null,
  };
}

type Row = {
  event: typeof table.$inferSelect;
  actorName: string | null;
  eventMachineName: string | null;
  job: typeof schema.workflowJob.$inferSelect | null;
  jobMachineName: string | null;
  private: boolean | null;
};

// Null for a row whose type or data no longer parses (a type that was since removed), so one bad
// row never breaks the page.
function presentEvent(row: Row, walk: RouteWalk | null): ActivityItem | null {
  const parsed = ActivityEvent.safeParse({ type: row.event.type, data: row.event.data });
  if (!parsed.success) return null;
  const event = parsed.data;
  const snapshot = "machineName" in event.data ? event.data.machineName : null;
  return {
    ...event,
    id: row.event.id,
    occurredAt: row.event.occurredAt.toISOString(),
    actor:
      row.event.actorUserId && row.actorName
        ? { id: row.event.actorUserId, name: row.actorName }
        : null,
    machine:
      snapshot === null
        ? null
        : { id: row.event.machineId, name: row.eventMachineName ?? snapshot },
    job: row.job ? presentJob(row.job, row.private, row.jobMachineName, walk) : null,
  };
}
