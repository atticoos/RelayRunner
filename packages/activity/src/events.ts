import { RUNNER_KEYS } from "@relayrunner/runner-order";
import { z } from "zod";

// The workspace's audit log: one append-only row per thing that happened, newest first on the
// Activity page. Each type's `data` is checked against its schema here when the API writes it, and
// the dashboard renders each type from the same definitions. Adding a type is a new entry in
// ActivityEvent (and how the page shows it), never a migration.

// The machine's name when the event happened, so the log still reads after a rename or a delete.
const machineData = { machineName: z.string() };

export const DISCONNECT_REASONS = ["closed", "timeout", "revoked", "error"] as const;
export type DisconnectReason = (typeof DISCONNECT_REASONS)[number];

// Why a step of the runner order didn't take a job (the Router's decideRoute).
export const SKIP_REASONS = [
  // The relay left that provider's input empty.
  "not_configured",
  // Machines never run a public repo's jobs.
  "public_repo",
  // No online, idle machine had every wanted label.
  "no_machine",
  // `github` named more than one label.
  "too_many_labels",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/**
 * How a pick walked the workspace's runner order. `step` is the provider that took the job (null
 * when nothing fit), `skipped` the earlier steps in order with why, and `notInOrder` the providers
 * the relay set that the order leaves out. `machine` and `github` are the relay's inputs.
 */
export const RouteWalk = z.object({
  step: z.enum(RUNNER_KEYS).nullable(),
  skipped: z.array(z.object({ key: z.enum(RUNNER_KEYS), reason: z.enum(SKIP_REASONS) })),
  notInOrder: z.array(z.enum(RUNNER_KEYS)),
  machine: z.array(z.string()),
  github: z.array(z.string()),
});
export type RouteWalk = z.infer<typeof RouteWalk>;

export const ActivityEvent = z.discriminatedUnion("type", [
  // A machine finished `relayrunner connect` enrollment and got its token. Actor: the user who
  // approved it.
  z.object({
    type: z.literal("machine.enrolled"),
    data: z.object({ ...machineData, os: z.string().nullable(), arch: z.string().nullable() }),
  }),
  // The machine's CLI connected and said hello: it can take jobs.
  z.object({
    type: z.literal("machine.connected"),
    data: z.object({ ...machineData, runnerVersion: z.string().nullable() }),
  }),
  // The machine went offline: its CLI closed the connection (`closed`), it went quiet past the
  // heartbeat timeout (`timeout`, e.g. sleep or lost network), it was revoked (`revoked`), or it
  // broke the protocol (`error`). A newer connection replacing an older one logs nothing.
  z.object({
    type: z.literal("machine.disconnected"),
    data: z.object({ ...machineData, reason: z.enum(DISCONNECT_REASONS) }),
  }),
  // Someone removed the machine from the workspace. Actor: that user.
  z.object({ type: z.literal("machine.revoked"), data: z.object(machineData) }),
  // Someone left the workspace (`left`), or an owner or admin removed them. Actor: whoever did it.
  // Each machine they enrolled there is revoked right after, logging its own machine.revoked.
  z.object({
    type: z.literal("member.removed"),
    data: z.object({ memberName: z.string(), left: z.boolean() }),
  }),
  // RelayRunner routed a job (a job in a run with a `runs-on: relayrunner` pick). Its row shows the
  // job's live state, so there is one event per job, not one per status change.
  z.object({ type: z.literal("job.routed"), data: z.object({}) }),
  // A relay failed fast because nothing in the runner order could take its run, so the job that
  // needed it never started. `reason` is the message the relay failed with on GitHub. `walk` is
  // null when the pick stopped before the order (e.g. RelayRunner can't see the repo).
  z.object({
    type: z.literal("job.unroutable"),
    data: z.object({
      repository: z.string(),
      runId: z.number(),
      runAttempt: z.number(),
      workflow: z.string().nullable(),
      // The relay job's name, e.g. "relay".
      job: z.string().nullable(),
      reason: z.string(),
      walk: RouteWalk.nullable(),
    }),
  }),
]);

export type ActivityEvent = z.infer<typeof ActivityEvent>;
export type ActivityEventType = ActivityEvent["type"];

/** The Activity page's filters: the part of the type before the dot. */
export const ACTIVITY_FILTERS = ["job", "machine"] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];
