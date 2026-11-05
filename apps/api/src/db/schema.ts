// Better Auth's tables in the shape its Drizzle adapter expects: the core four (user, session,
// account, verification), then the organization plugin's, renamed to workspaces (see auth.ts).
// Gateway tables (installations and their repos, then machines and routes) follow. After changing anything
// here, run `pnpm db:generate` to write a new migration.
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // The workspace the dashboard is looking at. Set by the organization plugin.
  activeWorkspaceId: text("active_workspace_id"),
  ...timestamps,
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
});

// A workspace is Better Auth's organization. It is created by a user (who becomes its owner), not
// mirrored from GitHub: it connects many GitHub App installations and owns the machine fleet.
export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  // JSON RunnerOrder (@relayrunner/runner-order). Null means the default order.
  runnerOrder: text("runner_order"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Membership is shaped for teams even though the MVP allows one member, the owner.
export const workspaceMember = sqliteTable(
  "workspace_member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("workspace_member_workspace_user_unique").on(table.workspaceId, table.userId),
    index("workspace_member_user_idx").on(table.userId),
  ],
);

export const workspaceInvitation = sqliteTable(
  "workspace_invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("workspace_invitation_workspace_idx").on(table.workspaceId),
    index("workspace_invitation_email_idx").on(table.email),
  ],
);

// A GitHub App installation (an org or a personal account). The installation id is the primary
// key and each row has one workspace_id, so an installation belongs to at most one workspace while
// a workspace can connect many. workspace_id is null while an installation is unclaimed (installed
// without going through a workspace's install link, or before the installer signed in). Rows are
// written by the Setup URL callback and by installation webhooks (src/installations.ts).
export const githubInstallation = sqliteTable(
  "github_installation",
  {
    id: integer("id").primaryKey({ autoIncrement: false }),
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "set null" }),
    accountId: integer("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    // 'Organization' or 'User', as GitHub reports it.
    accountType: text("account_type").notNull(),
    // 'all' or 'selected': whether the App sees every repo in the account or a chosen list.
    repositorySelection: text("repository_selection").notNull().default("all"),
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
    // When GitHub's view in this row was observed (a webhook's receivedAt, or a GET
    // /user/installations read). The queue is unordered and retries, so an older observation
    // never overwrites a newer one.
    githubStateAt: integer("github_state_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [index("github_installation_workspace_idx").on(table.workspaceId)],
);

// A repository an installation can see, mirrored from GitHub so activity can name its repo and
// tell public from private. RelayRunner doesn't manage repos and there is no opt-in: a job that
// asks for `runs-on: relayrunner` from a connected installation is the opt-in. Rows are written by
// webhooks (src/repositories.ts) and go away with their installation.
export const githubRepository = sqliteTable(
  "github_repository",
  {
    // GitHub's repository id, stable across renames and transfers.
    id: integer("id").primaryKey({ autoIncrement: false }),
    installationId: integer("installation_id")
      .notNull()
      .references(() => githubInstallation.id, { onDelete: "cascade" }),
    // owner/name, as of the latest event.
    fullName: text("full_name").notNull(),
    private: integer("private", { mode: "boolean" }).notNull(),
    // Set when the installation lost access (repo removed from the selection, deleted, or
    // transferred away). Kept as a tombstone rather than deleted, so a retried "added" that lands
    // after a newer "removed" can't bring the repo back. See githubStateAt.
    removedAt: integer("removed_at", { mode: "timestamp_ms" }),
    // When the event behind this row's state was received. Older events never overwrite newer ones.
    githubStateAt: integer("github_state_at", { mode: "timestamp_ms" }).notNull(),
    ...timestamps,
  },
  (table) => [index("github_repository_installation_idx").on(table.installationId)],
);

// Better Auth's device authorization plugin: one row per `relayrunner connect` sign-in in flight.
// The CLI polls with device_code while the user approves user_code in the dashboard. The plugin
// deletes the row once the CLI redeems it.
export const deviceCode = sqliteTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull().unique(),
  userCode: text("user_code").notNull().unique(),
  // Set when a signed-in user opens the approval page; only that user can approve or deny.
  userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  // 'pending', 'approved' or 'denied'.
  status: text("status").notNull(),
  lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
  ...timestamps,
});

// A machine enrolled with `relayrunner connect`. It belongs to one workspace and authenticates
// with its own token, not a user session. Enrollment runs in two steps (src/machines.ts):
// approving the device code in the dashboard creates the row with enrollment_hash set, and the
// CLI's claim fills in os/arch and token_hash and clears enrollment_hash. Revoking keeps the row
// so past routes can still name the machine.
export const machine = sqliteTable(
  "machine",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The protocol's values (linux, macos, windows; x64, arm64, arm). Null until claimed.
    os: text("os"),
    arch: text("arch"),
    // SHA-256 (hex) of the machine token. The token itself is only ever shown to the CLI.
    tokenHash: text("token_hash").unique(),
    // SHA-256 (hex) of the device code that approved this machine, while the claim is pending.
    enrollmentHash: text("enrollment_hash").unique(),
    // The user who approved the enrollment.
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [index("machine_workspace_idx").on(table.workspaceId)],
);

// A GitHub Actions job in a run that RelayRunner routed, for the dashboard's Activity page. A run
// is ours once its `runs-on: relayrunner` pick job arrives (kind 'pick'). Every other job in that
// run is stored too (kind 'job'): those are the real work, and GitHub has already resolved their
// `runs-on` to the pick's answer, so `labels` is the runner RelayRunner selected. Jobs from runs
// with no pick are never stored. Rows are written by workflow_job webhooks (src/jobs.ts) and go
// away with their installation.
export const workflowJob = sqliteTable(
  "workflow_job",
  {
    // GitHub's job id. A re-run gets new job ids under the same run id.
    id: integer("id").primaryKey({ autoIncrement: false }),
    installationId: integer("installation_id")
      .notNull()
      .references(() => githubInstallation.id, { onDelete: "cascade" }),
    repositoryId: integer("repository_id").notNull(),
    // owner/name when the job was last seen.
    repositoryFullName: text("repository_full_name").notNull(),
    runId: integer("run_id").notNull(),
    runAttempt: integer("run_attempt").notNull(),
    // 'pick' (asked for the relayrunner label) or 'job' (another job in a pick's run).
    kind: text("kind", { enum: ["pick", "job"] }).notNull(),
    workflowName: text("workflow_name"),
    name: text("name").notNull(),
    // The job's runs-on labels, as a JSON array. For a 'job' row this is the selected runner.
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull(),
    headBranch: text("head_branch"),
    headSha: text("head_sha").notNull(),
    // 'queued', 'in_progress' or 'completed' (GitHub also sends 'waiting'). Only moves forward:
    // the queue is unordered, so a late `queued` never rewinds a finished job.
    status: text("status").notNull(),
    conclusion: text("conclusion"),
    // The runner that took the job, once one has.
    runnerName: text("runner_name"),
    // The machine a route sent this job to, set when the job's `queued` webhook claims its
    // `rr-<route id>` label. Null for jobs that ran on a GitHub label, and once the machine is
    // deleted.
    machineId: text("machine_id").references(() => machine.id, { onDelete: "set null" }),
    githubCreatedAt: integer("github_created_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (table) => [
    index("workflow_job_installation_idx").on(table.installationId, table.id),
    index("workflow_job_run_idx").on(table.runId, table.kind),
  ],
);

// The workspace's audit log for the Activity page: one append-only row per event, typed by
// @relayrunner/activity (src/activity.ts writes and reads it). `data` holds the type's own fields
// as JSON. The id increases with time, so it orders the log and pages it. Rows go with their
// workspace, and a job's event goes with its workflow_job row.
export const activityEvent = sqliteTable(
  "activity_event",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    // e.g. 'machine.connected' or 'job.routed'.
    type: text("type").notNull(),
    // What the event is about. Each is set for its own kind of event, for joining live state.
    machineId: text("machine_id").references(() => machine.id, { onDelete: "set null" }),
    jobId: integer("job_id").references(() => workflowJob.id, { onDelete: "cascade" }),
    // The user who did it. Null for things RelayRunner or a machine did on their own.
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("activity_event_workspace_idx").on(table.workspaceId, table.id),
    // One event per type per job, so a redelivered webhook never logs a job twice. Machine events
    // have no job id, and NULLs never collide.
    uniqueIndex("activity_event_job_idx").on(table.jobId, table.type),
  ],
);
