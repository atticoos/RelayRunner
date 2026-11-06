import { api } from "@/lib/api";

/** One GitHub rate's jobs in the usage report (GET /api/usage). Money is USD. */
export type UsageRow = {
  runnerClass: string;
  label: string;
  /** USD per minute in a private repo. */
  perMinute: number;
  jobs: number;
  shortJobs: number;
  runSeconds: number;
  billedMinutes: number;
  shortBilledMinutes: number;
  cost: number;
  shortCost: number;
  roundingCost: number;
};

/** What the free checks saved (GET /api/usage/checks): a billed minute per check run. */
export type FreeCheckSavings = {
  days: number;
  /** The runner and rate each check is priced at. */
  runner: { label: string; perMinute: number };
  /** Check runs, each one billed minute saved, public repos included. */
  checks: number;
  /** USD, after free public-repo minutes. */
  savedCost: number;
  byRepository: {
    repository: string;
    private: boolean | null;
    checks: number;
    savedCost: number;
  }[];
};

export type UsageReport = {
  days: number;
  shortJobSeconds: number;
  totals: Omit<UsageRow, "runnerClass" | "label" | "perMinute">;
  byRunner: UsageRow[];
  byRepository: {
    repository: string;
    private: boolean | null;
    jobs: number;
    shortJobs: number;
    shortCost: number;
  }[];
};

/** The workspace's finished jobs over the last `days` days. */
export function getUsage(days = 30) {
  return api<UsageReport>(`/usage?days=${days}`);
}

/** The free checks' savings over the last `days` days. */
export function getCheckSavings(days = 30) {
  return api<FreeCheckSavings>(`/usage/checks?days=${days}`);
}

/** Example savings for `VITE_AUTH_DISABLED=true` dev builds, which have no API. */
export function sampleCheckSavings(days: number): FreeCheckSavings {
  const perMinute = 0.006;
  const app = Math.round(140 * (days / 30));
  const docs = Math.round(60 * (days / 30));
  return {
    days,
    runner: { label: "Linux 2-core", perMinute },
    checks: app + docs,
    savedCost: app * perMinute,
    byRepository: [
      { repository: "acme/app", private: true, checks: app, savedCost: app * perMinute },
      { repository: "acme/docs", private: false, checks: docs, savedCost: 0 },
    ],
  };
}

/** "$0.074" under a dollar (a minute can cost $0.002), "$12.40" above. */
export function money(usd: number) {
  return usd > 0 && usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

/** "142" or "1,204" minutes. */
export function minutes(value: number) {
  return Math.round(value).toLocaleString();
}
