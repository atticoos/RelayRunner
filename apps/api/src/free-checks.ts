// What the free checks saved: each check run the GitHub App posts (src/pr-title-check.ts) is a
// job that never ran on an Actions runner. Run as a workflow, it would be a few seconds on
// ubuntu-latest, billed as a whole minute. Each one is logged as a `check.completed` Activity
// event, and the Usage and Activity pages sum them.

import type { ActivityEvent } from "@relayrunner/activity";
import { and, eq, gte, sql } from "drizzle-orm";
import { recordEvent } from "./activity.ts";
import { type Db, schema } from "./db/index.ts";
import { createCheckRun } from "./github-app.ts";
import { findInstallation } from "./installations.ts";
import { cents, DAY_MS, rateFor, RUNNER_RATES } from "./job-timings.ts";

const table = schema.activityEvent;

// The runner a workflow running the same check would ask for. GitHub bills it one minute a run.
const FREE_CHECK_RUNNER = "linux-2-core" as const;

export type FreeCheck = Extract<ActivityEvent, { type: "check.completed" }>["data"];

/**
 * Posts a free check's run on a pull request and logs it, so every check the App posts counts
 * toward the minutes saved.
 */
export async function postFreeCheck(
  db: Db,
  token: string,
  installationId: number,
  pull: { repository: { id: number; fullName: string }; number: number },
  check: Parameters<typeof createCheckRun>[2],
) {
  const { url } = await createCheckRun(token, pull.repository.fullName, check);
  await recordFreeCheck(db, installationId, {
    check: check.name,
    repository: pull.repository.fullName,
    repositoryId: pull.repository.id,
    pullRequest: pull.number,
    headSha: check.headSha,
    conclusion: check.conclusion,
    url,
  });
}

/**
 * Logs a posted check run in the installation's workspace. Skipped when the installation has no
 * row or no workspace.
 */
export async function recordFreeCheck(db: Db, installationId: number, data: FreeCheck) {
  const installation = await findInstallation(db, installationId);
  if (!installation?.workspaceId) return false;
  await recordEvent(db, { workspaceId: installation.workspaceId, type: "check.completed", data });
  return true;
}

export interface FreeCheckSavings {
  days: number;
  /** The runner and rate each check is priced at. */
  runner: { label: string; perMinute: number };
  /** Check runs, each one billed minute saved, public repos included. */
  checks: number;
  /** USD, after free public-repo minutes. */
  savedCost: number;
  /** Repos with the most checks first. */
  byRepository: {
    repository: string;
    private: boolean | null;
    checks: number;
    savedCost: number;
  }[];
}

/** The workspace's free check runs from the last `days` days, and the money they saved. */
export async function freeCheckSavings(
  db: Db,
  workspaceId: string,
  days = 30,
): Promise<FreeCheckSavings> {
  const since = new Date(Date.now() - days * DAY_MS);
  const repositoryId = sql<number>`json_extract(${table.data}, '$.repositoryId')`;
  const rows = await db
    .select({
      repository: sql<string>`json_extract(${table.data}, '$.repository')`,
      private: schema.githubRepository.private,
      checks: sql<number>`count(*)`,
    })
    .from(table)
    .leftJoin(schema.githubRepository, eq(schema.githubRepository.id, repositoryId))
    .where(
      and(
        eq(table.workspaceId, workspaceId),
        eq(table.type, "check.completed"),
        gte(table.occurredAt, since),
      ),
    )
    .groupBy(repositoryId, schema.githubRepository.private);

  const byRepository = rows
    .map((row) => {
      const checks = Number(row.checks);
      return {
        repository: row.repository,
        private: row.private,
        checks,
        savedCost: cents(checks * rateFor(FREE_CHECK_RUNNER, row.private)),
      };
    })
    .sort((a, b) => b.checks - a.checks || b.savedCost - a.savedCost);
  const { label, perMinute } = RUNNER_RATES[FREE_CHECK_RUNNER];
  return {
    days,
    runner: { label, perMinute },
    checks: byRepository.reduce((sum, repo) => sum + repo.checks, 0),
    savedCost: cents(byRepository.reduce((sum, repo) => sum + repo.savedCost, 0)),
    byRepository: byRepository.slice(0, 10),
  };
}
