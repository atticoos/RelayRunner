import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authDisabled } from "@/lib/auth-client";
import {
  type FreeCheckSavings,
  getUsage,
  minutes,
  money,
  type UsageReport,
  type UsageRow,
} from "@/lib/usage";

const RANGES = [7, 30, 90] as const;

export const Route = createFileRoute("/_authed/_workspace/usage")({
  loader: (): Promise<UsageReport> =>
    authDisabled ? Promise.resolve(sampleReport(30)) : getUsage(30),
  component: UsagePage,
});

function UsagePage() {
  const first = Route.useLoaderData();
  const [report, setReport] = useState(first);
  const [days, setDays] = useState<number>(first.days);

  function chooseRange(next: number) {
    if (next === days) return;
    setDays(next);
    if (authDisabled) {
      setReport(sampleReport(next));
      return;
    }
    getUsage(next)
      .then(setReport)
      .catch(() => undefined);
  }

  const { totals } = report;
  const shortShare = totals.jobs ? Math.round((totals.shortJobs / totals.jobs) * 100) : 0;

  return (
    <section>
      <PageHeader title="Usage">
        Every job in your connected repos, whichever runner took it. GitHub bills each job by the
        minute, rounded up, so a job that finishes in seconds still pays for a whole minute.
      </PageHeader>
      <div className="grid max-w-4xl gap-6">
        <div role="group" aria-label="Range" className="flex gap-1.5">
          {RANGES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={days === value ? "secondary" : "ghost"}
              aria-pressed={days === value}
              onClick={() => chooseRange(value)}
            >
              {value} days
            </Button>
          ))}
        </div>

        {report.freeChecks.checks > 0 && <FreeChecks savings={report.freeChecks} />}

        {totals.jobs === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
            No finished jobs in the last {report.days} days. Jobs show up here once the GitHub App
            sees them run in a connected repo.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat
                label={`Jobs under ${report.shortJobSeconds}s`}
                value={totals.shortJobs.toLocaleString()}
                detail={`${shortShare}% of ${totals.jobs.toLocaleString()} jobs`}
              />
              <Stat
                label="Spent on short jobs"
                value={money(totals.shortCost)}
                detail={`${minutes(totals.shortBilledMinutes)} billed minutes`}
              />
              <Stat
                label="Lost to rounding up"
                value={money(totals.roundingCost)}
                detail={`of ${money(totals.cost)} estimated for all jobs`}
              />
            </div>

            <Table
              caption="By runner"
              head={["Runner", "Jobs", "Under a minute", "Billed min", "Short-job cost", "Total"]}
              rows={report.byRunner.map((row) => [
                <span key="runner">
                  {row.label}
                  <span className="ml-1.5 text-muted-foreground">
                    {row.perMinute ? `${money(row.perMinute)}/min` : "free"}
                  </span>
                </span>,
                row.jobs.toLocaleString(),
                row.shortJobs.toLocaleString(),
                minutes(row.billedMinutes),
                money(row.shortCost),
                money(row.cost),
              ])}
            />

            <Table
              caption="Repositories with the most short-job cost"
              head={["Repository", "Jobs", "Under a minute", "Short-job cost"]}
              rows={report.byRepository.map((repo) => [
                <RepoName key="repo" repository={repo.repository} isPrivate={repo.private} />,
                repo.jobs.toLocaleString(),
                repo.shortJobs.toLocaleString(),
                money(repo.shortCost),
              ])}
            />

            <p className="max-w-[62ch] text-sm text-muted-foreground">
              Estimates use GitHub's per-minute prices for private repos: Linux 1-core $0.002, Linux
              2-core $0.006, Windows $0.010, macOS $0.062. Standard runners in public repos and
              self-hosted runners are free. Larger runners are priced as Linux 2-core, so their cost
              is a floor. Skipped jobs and jobs cancelled before a runner took them aren't counted.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

// The check runs the GitHub App posted instead of a workflow job: each would have billed a minute.
function FreeChecks({ savings }: { savings: FreeCheckSavings }) {
  const { runner } = savings;
  return (
    <div className="grid gap-3">
      <h2 className="font-semibold">Saved by free checks</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Check runs"
          value={savings.checks.toLocaleString()}
          detail="posted by the GitHub App, no runner"
        />
        <Stat
          label="Billed minutes saved"
          value={minutes(savings.savedMinutes)}
          detail={`one ${runner.label} minute per check`}
        />
        <Stat
          label="Saved"
          value={money(savings.savedCost)}
          detail={`at ${money(runner.perMinute)}/min in private repos`}
        />
      </div>
      {savings.byRepository.length > 1 && (
        <Table
          caption="Free checks by repository"
          head={["Repository", "Check runs", "Saved"]}
          rows={savings.byRepository.map((repo) => [
            <RepoName key="repo" repository={repo.repository} isPrivate={repo.private} />,
            repo.checks.toLocaleString(),
            money(repo.savedCost),
          ])}
        />
      )}
      <p className="max-w-[62ch] text-sm text-muted-foreground">
        Each check run stands in for a workflow job that would take a few seconds on ubuntu-latest
        and still bill a whole minute. Public repos don't pay for standard runners, so their checks
        save minutes but no money.
      </p>
    </div>
  );
}

function RepoName({ repository, isPrivate }: { repository: string; isPrivate: boolean | null }) {
  return (
    <span className="font-mono">
      {repository}
      {isPrivate === false && (
        <span className="ml-1.5 font-sans text-muted-foreground">public, free</span>
      )}
    </span>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className="gap-0 px-4 py-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-sm text-muted-foreground">{detail}</div>
    </Card>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <caption className="px-4 pt-3 pb-2 text-left font-semibold">{caption}</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            {head.map((cell, i) => (
              <th
                key={cell}
                scope="col"
                className={`px-4 py-2 font-normal whitespace-nowrap ${i ? "text-right" : "text-left"}`}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b last:border-0">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`px-4 py-2 ${i ? "text-right whitespace-nowrap tabular-nums" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TOTAL_KEYS = [
  "jobs",
  "shortJobs",
  "runSeconds",
  "billedMinutes",
  "shortBilledMinutes",
  "cost",
  "shortCost",
  "roundingCost",
] as const satisfies (keyof UsageReport["totals"])[];

// For local development without an API (auth disabled).
function sampleReport(days: number): UsageReport {
  const scale = days / 30;
  const row = (
    runnerClass: string,
    label: string,
    perMinute: number,
    jobs: number,
    shortJobs: number,
    billedMinutes: number,
  ): UsageRow => {
    const j = Math.round(jobs * scale);
    const s = Math.round(shortJobs * scale);
    const b = Math.round(billedMinutes * scale);
    return {
      runnerClass,
      label,
      perMinute,
      jobs: j,
      shortJobs: s,
      runSeconds: b * 40,
      billedMinutes: b,
      shortBilledMinutes: s,
      cost: b * perMinute,
      shortCost: s * perMinute,
      roundingCost: b * perMinute * 0.33,
    };
  };
  const byRunner = [
    row("macos", "macOS", 0.062, 120, 40, 900),
    row("linux-2-core", "Linux 2-core", 0.006, 2400, 1500, 6200),
    row("self-hosted", "Self-hosted", 0, 300, 90, 1400),
  ];
  return {
    days,
    shortJobSeconds: 60,
    totals: Object.fromEntries(
      TOTAL_KEYS.map((key) => [key, byRunner.reduce((total, r) => total + r[key], 0)]),
    ) as UsageReport["totals"],
    byRunner,
    byRepository: [
      { repository: "acme/app", private: true, jobs: 1800, shortJobs: 1100, shortCost: 8.9 },
      { repository: "acme/docs", private: false, jobs: 400, shortJobs: 380, shortCost: 0 },
    ],
    freeChecks: sampleChecks(days),
  };
}

function sampleChecks(days: number): FreeCheckSavings {
  const app = Math.round(140 * (days / 30));
  const docs = Math.round(60 * (days / 30));
  return {
    days,
    runner: { label: "Linux 2-core", perMinute: 0.006 },
    checks: app + docs,
    savedMinutes: app + docs,
    savedCost: app * 0.006,
    byRepository: [
      { repository: "acme/app", private: true, checks: app, savedCost: app * 0.006 },
      { repository: "acme/docs", private: false, checks: docs, savedCost: 0 },
    ],
  };
}
