import { createFileRoute } from "@tanstack/react-router";
import { Ban, Cloud, ExternalLink, Laptop, Lock, Plug, Plus, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  duration,
  getActivity,
  timeAgo,
  type ActivityFilter,
  type ActivityItem,
  type ActivityJob,
  type ActivityPage,
} from "@/lib/activity";
import { authDisabled } from "@/lib/auth-client";

// Fast enough that a push shows up within seconds, without a live connection.
const POLL_MS = 5_000;

export const Route = createFileRoute("/_authed/_workspace/activity")({
  loader: (): Promise<ActivityPage> =>
    authDisabled ? Promise.resolve(samplePage(undefined)) : getActivity(),
  component: ActivityPage,
});

const FILTERS: { value: ActivityFilter | undefined; label: string }[] = [
  { value: undefined, label: "All" },
  { value: "job", label: "Jobs" },
  { value: "machine", label: "Machines" },
];

function ActivityPage() {
  const first = Route.useLoaderData();
  const [filter, setFilter] = useState<ActivityFilter | undefined>(undefined);
  const [latest, setLatest] = useState(first);
  const [older, setOlder] = useState<ActivityItem[]>([]);
  // Where the next older page starts, once one has been loaded. Before that it's the newest page's.
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Refresh the newest page while the tab is visible, and right away when the filter changes.
  // Older pages don't change much, so they're left as loaded.
  useEffect(() => {
    if (authDisabled) return;
    let current = true;
    const refresh = () =>
      getActivity({ filter })
        .then((page) => current && setLatest(page))
        .catch(() => undefined); // Keep showing the last good page; the next tick retries.
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [filter]);

  function chooseFilter(next: ActivityFilter | undefined) {
    if (next === filter) return;
    setFilter(next);
    setOlder([]);
    setOlderCursor(null);
    if (authDisabled) {
      setLatest(samplePage(next));
      return;
    }
    getActivity({ filter: next })
      .then(setLatest)
      .catch(() => undefined);
  }

  const cursor = older.length ? olderCursor : latest.nextBefore;

  async function loadOlder() {
    if (cursor === null) return;
    setLoadingOlder(true);
    try {
      const page = await getActivity({ before: cursor, filter });
      setOlder((items) => [...items, ...page.items]);
      setOlderCursor(page.nextBefore);
    } finally {
      setLoadingOlder(false);
    }
  }

  const seen = new Set(latest.items.map((item) => item.id));
  const items = [...latest.items, ...older.filter((item) => !seen.has(item.id))];

  return (
    <section>
      <PageHeader title="Activity">
        Everything that happened in this workspace, newest first: the jobs RelayRunner routed and
        where each one ran, and machines coming and going. Updates every few seconds.
      </PageHeader>
      <div className="grid max-w-4xl gap-2">
        <div role="group" aria-label="Show" className="flex gap-1.5">
          {FILTERS.map(({ value, label }) => (
            <Button
              key={label}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              aria-pressed={filter === value}
              onClick={() => chooseFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {items.length === 0 ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
            {filter === "machine" ? (
              <>Nothing yet. Machines show up here when they enroll, connect or disconnect.</>
            ) : (
              <>
                Nothing yet. Add a{" "}
                <span className="font-mono text-foreground">runs-on: relayrunner</span> pick job to
                a workflow in a connected org, push, and its jobs show up here.
              </>
            )}
          </p>
        ) : (
          <ul className="grid gap-2">
            {items.map((item) =>
              item.job ? (
                <JobRow key={item.id} job={item.job} now={now} />
              ) : (
                <EventRow key={item.id} item={item} now={now} />
              ),
            )}
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
            {loadingOlder ? "Loading…" : "Show older"}
          </Button>
        )}
      </div>
    </section>
  );
}

const DISCONNECT_REASONS = {
  closed: "its CLI stopped",
  timeout: "it stopped responding",
  revoked: "it was revoked",
  error: "of a protocol error",
} as const;

// What a non-job event says, in a sentence after the machine's name.
function sentence(item: ActivityItem) {
  switch (item.type) {
    case "machine.enrolled": {
      const platform = [item.data.os, item.data.arch].filter(Boolean).join(" ");
      return `enrolled${platform ? ` (${platform})` : ""}`;
    }
    case "machine.connected":
      return "connected";
    case "machine.disconnected":
      return `disconnected because ${DISCONNECT_REASONS[item.data.reason]}`;
    case "machine.revoked":
      return "was revoked";
    case "job.routed":
      return "routed a job";
  }
}

const EVENT_ICONS = {
  "machine.enrolled": Plus,
  "machine.connected": Plug,
  "machine.disconnected": Unplug,
  "machine.revoked": Ban,
  "job.routed": Laptop,
} as const;

// A one-line row for anything that isn't a job: "Atticus's MacBook connected · 2m ago".
function EventRow({ item, now }: { item: ActivityItem; now: number }) {
  const Icon = EVENT_ICONS[item.type];
  const online = item.type === "machine.connected";
  return (
    <li className="flex min-w-0 items-start gap-2 px-4 py-1.5 text-sm">
      <Icon
        aria-hidden
        className={
          online
            ? "mt-0.5 size-3.5 shrink-0 text-go"
            : "mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        }
      />
      <p className="min-w-0">
        <span className="font-medium">{item.machine?.name ?? "A machine"}</span>{" "}
        <span className="text-muted-foreground">{sentence(item)}</span>
        {item.actor && <span className="text-muted-foreground"> by {item.actor.name}</span>}{" "}
        <span
          className="whitespace-nowrap text-xs text-muted-foreground"
          title={new Date(item.occurredAt).toLocaleString()}
        >
          · {timeAgo(item.occurredAt, now)}
        </span>
      </p>
    </li>
  );
}

function JobRow({ job, now }: { job: ActivityJob; now: number }) {
  const took = duration(job, now);
  return (
    <li className="grid gap-x-4 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <a
          href={job.runUrl}
          target="_blank"
          rel="noreferrer"
          className="truncate text-muted-foreground hover:text-foreground hover:underline"
          title="Open the run on GitHub"
        >
          {job.workflow ?? "Workflow"}
        </a>
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
        <RunnerChip job={job} />
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

function RunnerChip({ job }: { job: ActivityJob }) {
  const { runner } = job;
  const title = job.runnerName ? `Ran on ${job.runnerName}` : "Not picked up yet";
  if (runner.type === "machine")
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md border border-go-edge bg-go-soft px-1.5 py-0.5 text-xs"
        title={title}
      >
        <Laptop aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{runner.name ?? "Local machine"}</span>
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs"
      title={title}
    >
      <Cloud aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{runner.label || "unknown"}</span>
    </span>
  );
}

function StatusBadge({ job }: { job: ActivityJob }) {
  if (job.status === "in_progress") return <Badge variant="run">Running</Badge>;
  if (job.status !== "completed")
    return (
      <Badge variant="idle">
        {job.runner.type === "machine" ? `Waiting for ${job.runner.name ?? "a machine"}` : "Queued"}
      </Badge>
    );
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

// Example entries for `VITE_AUTH_DISABLED=true` dev builds, which have no API.
function samplePage(filter: ActivityFilter | undefined): ActivityPage {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const runs = "https://github.com/relayrunner/relayrunner-ci-tests/actions/runs";
  const job = (id: number, minutesAgo: number, rest: Partial<ActivityJob>): ActivityJob => ({
    id,
    repository: "relayrunner/relayrunner-ci-tests",
    private: true,
    runId: id * 10,
    runAttempt: 1,
    workflow: "RelayRunner dev",
    name: "test",
    runner: { type: "github", label: "ubuntu-latest" },
    runnerName: null,
    branch: "main",
    sha: "abc123",
    status: "queued",
    conclusion: null,
    createdAt: at(minutesAgo),
    startedAt: null,
    completedAt: null,
    url: `${runs}/${id * 10}/job/${id}`,
    runUrl: `${runs}/${id * 10}`,
    ...rest,
  });
  const mac = { id: "m1", name: "Atticus's MacBook" };
  const items: ActivityItem[] = [
    {
      id: 7,
      type: "job.routed",
      data: {},
      occurredAt: at(0.2),
      actor: null,
      machine: null,
      job: job(3, 0.2, {
        runner: { type: "machine", machineId: "m1", name: mac.name },
        runnerName: "Atticus-s-MacBook-0123456789ab",
        status: "in_progress",
        startedAt: at(0.1),
      }),
    },
    {
      id: 6,
      type: "machine.connected",
      data: { machineName: mac.name, runnerVersion: "2.330.0" },
      occurredAt: at(1),
      actor: null,
      machine: mac,
      job: null,
    },
    {
      id: 5,
      type: "machine.disconnected",
      data: { machineName: mac.name, reason: "timeout" },
      occurredAt: at(25),
      actor: null,
      machine: mac,
      job: null,
    },
    {
      id: 4,
      type: "job.routed",
      data: {},
      occurredAt: at(38),
      actor: null,
      machine: null,
      job: job(2, 38, {
        private: false,
        runnerName: "GitHub Actions 7",
        status: "completed",
        conclusion: "success",
        startedAt: at(37.5),
        completedAt: at(36),
      }),
    },
    {
      id: 2,
      type: "machine.enrolled",
      data: { machineName: mac.name, os: "macos", arch: "arm64" },
      occurredAt: at(60),
      actor: { id: "u1", name: "Atticus White" },
      machine: mac,
      job: null,
    },
  ];
  return {
    nextBefore: null,
    items: filter ? items.filter((item) => item.type.startsWith(`${filter}.`)) : items,
  };
}
