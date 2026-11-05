import { createFileRoute } from "@tanstack/react-router";
import {
  Ban,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Cloud,
  Laptop,
  LoaderCircle,
  Lock,
  Plug,
  Plus,
  Unplug,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
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
      <PageHeader title="Activity">Routed jobs and machine events, newest first.</PageHeader>
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
                <span className="font-mono text-foreground">relayrunner/actions</span> relay job to
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

const ICON = "size-3.5 shrink-0";

// Every Activity row: an icon, one line of text that ends in "…" when it doesn't fit (hover shows
// all of it), and the time pinned on the right.
function Row({
  icon,
  at,
  now,
  children,
}: {
  icon: ReactNode;
  at: string;
  now: number;
  children: ReactNode;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 px-4 py-1.5 text-sm">
      {icon}
      <p
        className="min-w-0 flex-1 truncate"
        ref={(el) => {
          if (el) el.title = el.textContent ?? "";
        }}
      >
        {children}
      </p>
      <span
        className="shrink-0 text-xs text-muted-foreground tabular-nums"
        title={new Date(at).toLocaleString()}
      >
        {timeAgo(at, now)}
      </span>
    </li>
  );
}

// A one-line row for anything that isn't a job: "Atticus's MacBook connected · 2m ago".
function EventRow({ item, now }: { item: ActivityItem; now: number }) {
  const Icon = EVENT_ICONS[item.type];
  const online = item.type === "machine.connected";
  return (
    <Row
      icon={
        <Icon
          aria-hidden
          className={online ? `${ICON} text-go` : `${ICON} text-muted-foreground`}
        />
      }
      at={item.occurredAt}
      now={now}
    >
      <span className="font-medium">{item.machine?.name ?? "A machine"}</span>{" "}
      <span className="text-muted-foreground">{sentence(item)}</span>
      {item.actor && <span className="text-muted-foreground"> by {item.actor.name}</span>}
    </Row>
  );
}

// What happened to the job, and where: "passed on", "waiting for", ...
function jobVerb(job: ActivityJob) {
  if (job.status === "in_progress") return "running on";
  if (job.status !== "completed")
    return job.runner.type === "machine" ? "waiting for" : "queued for";
  if (job.conclusion === "success") return "passed on";
  if (job.conclusion === "failure" || job.conclusion === "timed_out") return "failed on";
  return `${job.conclusion?.replace("_", " ") ?? "finished"} on`;
}

function JobIcon({ job }: { job: ActivityJob }) {
  const base = ICON;
  if (job.status === "in_progress")
    return <LoaderCircle aria-label="Running" className={`${base} animate-spin text-run`} />;
  if (job.status !== "completed")
    return <Clock aria-label="Queued" className={`${base} text-muted-foreground`} />;
  if (job.conclusion === "success")
    return <CircleCheck aria-label="Passed" className={`${base} text-go`} />;
  if (job.conclusion === "failure" || job.conclusion === "timed_out")
    return <CircleX aria-label="Failed" className={`${base} text-destructive`} />;
  return <CircleMinus aria-label="Finished" className={`${base} text-muted-foreground`} />;
}

// A row in the same shape as EventRow, naming the job the way GitHub does ("workflow / job"):
// "RelayRunner dev / test passed on Atticus's MacBook ·
// relayrunner-ci-tests · main · 1m 30s", then the time. The job name opens the job on
// GitHub, the workflow name opens its run.
function JobRow({ job, now }: { job: ActivityJob; now: number }) {
  const took = duration(job, now);
  const { runner } = job;
  const RunnerIcon = runner.type === "machine" ? Laptop : Cloud;
  const runnerName =
    runner.type === "machine" ? (runner.name ?? "a local machine") : runner.label || "unknown";
  return (
    <Row icon={<JobIcon job={job} />} at={job.createdAt} now={now}>
      <a
        href={job.runUrl}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground hover:text-foreground hover:underline"
        title="Open the run on GitHub"
      >
        {job.workflow ?? "Workflow"}
      </a>
      <span className="text-muted-foreground"> / </span>
      <a
        href={job.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium hover:underline"
        title="Open the job on GitHub"
      >
        {job.name}
      </a>{" "}
      <span className="text-muted-foreground">{jobVerb(job)}</span>{" "}
      <span
        className="font-medium"
        title={job.runnerName ? `Ran on ${job.runnerName}` : "Not picked up yet"}
      >
        <RunnerIcon
          aria-hidden
          className="mr-1 inline size-3 align-[-0.1em] text-muted-foreground"
        />
        <span className={runner.type === "github" ? "font-mono text-xs" : undefined}>
          {runnerName}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">
        {" · "}
        {job.private && (
          <Lock aria-label="Private repo" className="mr-1 inline size-3 align-[-0.1em]" />
        )}
        <span className="font-mono">{job.repository}</span>
        {job.branch && (
          <>
            {" · "}
            <span className="font-mono">{job.branch}</span>
          </>
        )}
        {took && <span className="tabular-nums">{` · ${took}`}</span>}
      </span>
    </Row>
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
  const mac = { id: "m1", name: "Atticuss-MacBook-Pro.local" };
  const items: ActivityItem[] = [
    {
      id: 7,
      type: "job.routed",
      data: {},
      occurredAt: at(0.2),
      actor: null,
      machine: null,
      job: job(3, 0.2, {
        workflow: "RelayRunner machine test",
        name: "machine",
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
