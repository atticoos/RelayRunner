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

/** "$0.074" under a dollar (a minute can cost $0.002), "$12.40" above. */
export function money(usd: number) {
  return usd > 0 && usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}

/** "142" or "1,204" minutes. */
export function minutes(value: number) {
  return Math.round(value).toLocaleString();
}
