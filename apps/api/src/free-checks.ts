// What the free checks saved: each check run the GitHub App posts (src/pr-title-check.ts) is a
// job that never ran on an Actions runner. Run as a workflow, it would be a few seconds on
// ubuntu-latest, billed as a whole minute. Each one is logged as a `check.completed` Activity
// event, and the Usage page sums them.

import { and, eq, gte, sql } from "drizzle-orm";
import { recordEvent } from "./activity.ts";
import { type Db, schema } from "./db/index.ts";
import { findInstallation } from "./installations.ts";
import { RUNNER_RATES } from "./job-timings.ts";

const table = schema.activityEvent;
const DAY_MS = 86_400_000;

// The runner a workflow running the same check would ask for, and the minutes GitHub would bill.
export const FREE_CHECK_RUNNER = "linux-2-core" as const;
export const FREE_CHECK_MINUTES = 1;

export interface FreeCheck {
  check: string;
  repository: { id: number; fullName: string };
  pullRequest: number;
  headSha: string;
  conclusion: "success" | "failure";
  url: string | null;
}

/**
 * Logs a posted check run in the installation's workspace. Skipped when the installation has no
 * row or no workspace.
 */
export async function recordFreeCheck(db: Db, installationId: number, check: FreeCheck) {
  const installation = await findInstallation(db, installationId);
  if (!installation?.workspaceId) return false;
  await recordEvent(db, {
    workspaceId: installation.workspaceId,
    type: "check.completed",
    data: {
      check: check.check,
      repository: check.repository.fullName,
      repositoryId: check.repository.id,
      pullRequest: check.pullRequest,
      headSha: check.headSha,
      conclusion: check.conclusion,
      url: check.url,
    },
  });
  return true;
}

export interface FreeCheckSavings {
  days: number;
  /** The runner and rate each check is priced at. */
  runner: { label: string; perMinute: number };
  checks: number;
  /** Billed minutes the checks would have used, public repos included. */
  savedMinutes: number;
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

/** The workspace's free check runs from the last `days` days, and the minutes and money they saved. */
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

  const { label, perMinute } = RUNNER_RATES[FREE_CHECK_RUNNER];
  // Unknown visibility counts as private, as in the usage report.
  const byRepository = rows
    .map((row) => {
      const checks = Number(row.checks);
      const rate = row.private === false ? 0 : perMinute;
      return {
        repository: row.repository,
        private: row.private ?? null,
        checks,
        savedCost: cents(checks * FREE_CHECK_MINUTES * rate),
      };
    })
    .sort((a, b) => b.checks - a.checks || b.savedCost - a.savedCost);
  const checks = byRepository.reduce((sum, repo) => sum + repo.checks, 0);
  return {
    days,
    runner: { label, perMinute },
    checks,
    savedMinutes: checks * FREE_CHECK_MINUTES,
    savedCost: cents(byRepository.reduce((sum, repo) => sum + repo.savedCost, 0)),
    byRepository: byRepository.slice(0, 10),
  };
}

function cents(value: number) {
  return Math.round(value * 1000) / 1000;
}
