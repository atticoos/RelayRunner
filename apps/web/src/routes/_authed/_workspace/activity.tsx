import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  duration,
  getActivity,
  timeAgo,
  type ActivityJob,
  type ActivityPage,
} from "@/lib/activity";
import { authDisabled } from "@/lib/auth-client";

// Fast enough that a push shows up within seconds, without a live connection.
const POLL_MS = 5_000;

export const Route = createFileRoute("/_authed/_workspace/activity")({
  loader: (): Promise<ActivityPage> =>
    authDisabled ? Promise.resolve(samplePage()) : getActivity(),
  component: ActivityPage,
});

function ActivityPage() {
  const first = Route.useLoaderData();
  const [latest, setLatest] = useState(first);
  const [older, setOlder] = useState<ActivityJob[]>([]);
  // Where the next older page starts, once one has been loaded. Before that it's the newest page's.
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Refresh the newest page while the tab is visible. Older pages don't change much, so they're
  // left as loaded.
  useEffect(() => {
    if (authDisabled) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState !== "visible") return;
      getActivity()
        .then(setLatest)
        .catch(() => undefined); // Keep showing the last good page; the next tick retries.
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const cursor = older.length ? olderCursor : latest.nextBefore;

  async function loadOlder() {
    if (cursor === null) return;
    setLoadingOlder(true);
    try {
      const page = await getActivity(cursor);
      setOlder((jobs) => [...jobs, ...page.jobs]);
      setOlderCursor(page.nextBefore);
    } finally {
      setLoadingOlder(false);
    }
  }

  const seen = new Set(latest.jobs.map((job) => job.id));
  const jobs = [...latest.jobs, ...older.filter((job) => !seen.has(job.id))];

  return (
    <section>
      <PageHeader title="Activity">
        Jobs RelayRunner routed, newest first, and the runner it picked for each one. Updates every
        few seconds.
      </PageHeader>
      <div className="grid max-w-4xl gap-2">
        {jobs.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
            No jobs yet. Add a{" "}
            <span className="font-mono text-foreground">runs-on: relayrunner</span> pick job to a
            workflow in a connected org, push, and its jobs show up here.
          </p>
        ) : (
          <ul className="grid gap-2">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} now={now} />
            ))}
          </ul>
        )}
        {cursor !== null && (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? "Loading…" : "Show older jobs"}
          </Button>
        )}
      </div>
    </section>
  );
}

function JobRow({ job, now }: { job: ActivityJob; now: number }) {
  const took = duration(job, now);
  return (
    <li className="grid gap-x-4 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="truncate text-muted-foreground">{job.workflow ?? "Workflow"}</span>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 font-medium hover:underline"
        >
          <span className="truncate">{job.name}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        </a>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <span
          className="rounded-md border border-go-edge bg-go-soft px-1.5 py-0.5 font-mono text-xs"
          title={job.runnerName ? `Ran on ${job.runnerName}` : "Not picked up yet"}
        >
          {job.runner || "unknown"}
        </span>
      </div>
      <div className="flex items-center gap-2 sm:justify-self-end">
        <StatusBadge job={job} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:col-span-2">
        <span className="inline-flex min-w-0 items-center gap-1 font-mono">
          {job.private && <Lock aria-label="Private repo" className="size-3 shrink-0" />}
          <span className="truncate">{job.repository}</span>
        </span>
        {job.branch && <span className="truncate font-mono">{job.branch}</span>}
        <span title={new Date(job.createdAt).toLocaleString()}>{timeAgo(job.createdAt, now)}</span>
        {took && <span className="tabular-nums">{took}</span>}
      </div>
    </li>
  );
}

function StatusBadge({ job }: { job: ActivityJob }) {
  if (job.status === "in_progress") return <Badge variant="run">Running</Badge>;
  if (job.status !== "completed") return <Badge variant="idle">Queued</Badge>;
  if (job.conclusion === "success") return <Badge variant="go">Passed</Badge>;
  if (job.conclusion === "failure" || job.conclusion === "timed_out")
    return (
      <Badge variant="outline" className="border-destructive/60 text-destructive">
        Failed
      </Badge>
    );
  return (
    <Badge variant="idle" className="capitalize">
      {job.conclusion?.replace("_", " ") ?? "Done"}
    </Badge>
  );
}

// Example rows for `VITE_AUTH_DISABLED=true` dev builds, which have no API.
function samplePage(): ActivityPage {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const base = {
    repository: "relayrunner/relayrunner-ci-tests",
    private: false,
    runAttempt: 1,
    workflow: "RelayRunner dev",
    runner: "ubuntu-latest",
    branch: "main",
    sha: "abc123",
    url: "https://github.com/relayrunner/relayrunner-ci-tests/actions",
  };
  return {
    nextBefore: null,
    jobs: [
      {
        ...base,
        id: 3,
        runId: 30,
        name: "test",
        runnerName: null,
        status: "queued",
        conclusion: null,
        createdAt: at(0.2),
        startedAt: null,
        completedAt: null,
      },
      {
        ...base,
        id: 2,
        runId: 20,
        name: "test",
        runnerName: "GitHub Actions 12",
        status: "in_progress",
        conclusion: null,
        createdAt: at(2),
        startedAt: at(1.5),
        completedAt: null,
      },
      {
        ...base,
        id: 1,
        runId: 10,
        name: "test",
        private: true,
        repository: "relayrunner/relayrunner",
        workflow: "CI",
        runnerName: "GitHub Actions 7",
        status: "completed",
        conclusion: "success",
        createdAt: at(40),
        startedAt: at(39.5),
        completedAt: at(38),
      },
    ],
  };
}
