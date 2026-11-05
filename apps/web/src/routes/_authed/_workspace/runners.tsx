import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_RUNNER_ORDER,
  RUNNER_KEYS,
  RUNNER_LABELS,
  type RunnerKey,
  type RunnerStep,
} from "@relayrunner/runner-order";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  GripVerticalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AddRunner } from "@/components/add-runner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authDisabled } from "@/lib/auth-client";
import {
  listMachines,
  pauseMachine,
  resumeMachine,
  revokeMachine,
  timeAgo,
  type Machine,
} from "@/lib/machines";
import { canManage } from "@/lib/roles";
import { RunnerOrderError, getRunnerOrder, saveRunnerOrder } from "@/lib/runner-order";
import { cn } from "@/lib/utils";

// How often the page refetches machines, so a machine connecting or going quiet shows up.
const REFRESH_MS = 15_000;

const machineBadge = {
  idle: { variant: "go", label: "Online · Idle" },
  busy: { variant: "run", label: "Online · Busy" },
  offline: { variant: "idle", label: "Offline" },
} as const;

export const Route = createFileRoute("/_authed/_workspace/runners")({
  loader: async ({ context }) => {
    try {
      const [order, { machines }] = await Promise.all([
        getRunnerOrder(context.current.workspace.id),
        listMachines(),
      ]);
      return { ...order, machines };
    } catch (error) {
      // The dev preview has no API behind it.
      if (authDisabled) return { order: DEFAULT_RUNNER_ORDER, isDefault: true, machines: [] };
      throw error;
    }
  },
  component: RunnersPage,
});

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

// The page is the runner order: providers in the order jobs try them, each with its runners.
// Moving a section moves that provider in the order. Providers left out sit at the bottom.
function RunnersPage() {
  const loaded = Route.useLoaderData();
  const { current } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    if (authDisabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void router.invalidate();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const [saved, setSaved] = useState({ steps: loaded.order.steps, isDefault: loaded.isDefault });
  const [steps, setSteps] = useState<RunnerStep[]>(loaded.order.steps);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const dirty = keys(steps) !== keys(saved.steps);
  // Owners and admins change the order (#134); members read it. The API refuses a member's save.
  const editable = canManage(current.role);
  const unused = RUNNER_KEYS.filter((key) => !steps.some((step) => step.key === key));

  function change(next: RunnerStep[]) {
    setSteps(next);
    setStatus({ kind: "idle" });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = steps.findIndex((step) => step.key === active.id);
    const to = steps.findIndex((step) => step.key === over.id);
    change(arrayMove(steps, from, to));
  }

  async function save() {
    setStatus({ kind: "saving" });
    try {
      const result = await saveRunnerOrder(current.workspace.id, { steps });
      setSaved({ steps: result.order.steps, isDefault: result.isDefault });
      setStatus({ kind: "saved" });
    } catch (error) {
      const message =
        error instanceof RunnerOrderError && error.reason
          ? error.reason
          : "Couldn't save the order. Try again.";
      setStatus({ kind: "error", message });
    }
  }

  const body = (key: RunnerKey) =>
    key === "machine" ? <MachineList machines={loaded.machines} /> : null;

  return (
    <section>
      <PageHeader title="Runners" action={<AddRunner />}>
        Jobs try these providers from top to bottom.{" "}
        {editable
          ? "Move a section to change the order."
          : "Owners and admins can change the order."}
      </PageHeader>
      <div className="grid max-w-3xl gap-3">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={steps.map((step) => step.key)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="grid gap-3" aria-label="Runner order">
              {steps.map((step, index) => (
                <ProviderSection
                  key={step.key}
                  providerKey={step.key}
                  meta={meta(step.key, loaded.machines)}
                  position={index + 1}
                  editable={editable}
                  canMoveUp={index > 0}
                  canMoveDown={index < steps.length - 1}
                  canRemove={steps.length > 1}
                  onMove={(by) => change(arrayMove(steps, index, index + by))}
                  onRemove={() => change(steps.filter((_, i) => i !== index))}
                >
                  {body(step.key)}
                </ProviderSection>
              ))}
            </ol>
          </SortableContext>
        </DndContext>

        {unused.map((key) => (
          <UnusedSection
            key={key}
            providerKey={key}
            onAdd={editable ? () => change([...steps, { key }]) : undefined}
          >
            {body(key)}
          </UnusedSection>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
          <div className="grid gap-0.5">
            <span className="text-sm font-semibold text-muted-foreground">Blacksmith</span>
            <span className="text-xs text-muted-foreground">Not available yet.</span>
          </div>
          <Badge variant="idle" className="px-1.5 text-[10px] tracking-wider">
            SOON
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground">
          Jobs use the first provider here that they configure and that can take them. Jobs nothing
          fits won't run.
        </p>

        {(dirty || status.kind !== "idle") && (
          <div
            className={cn(
              "sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-secondary px-4 py-2.5 shadow-lg",
              dirty ? "border-go-edge" : "border-border",
            )}
          >
            <span role="status" className="text-sm">
              {status.kind === "error" ? (
                <span className="text-destructive">{status.message}</span>
              ) : status.kind === "saved" && !dirty ? (
                <span className="text-muted-foreground">Order saved.</span>
              ) : (
                <span className="text-muted-foreground">You changed the runner order.</span>
              )}
            </span>
            {dirty && (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => change(saved.steps)}>
                  Discard
                </Button>
                <Button size="sm" disabled={status.kind === "saving"} onClick={() => void save()}>
                  {status.kind === "saving" ? "Saving…" : "Save order"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const keys = (steps: RunnerStep[]) => steps.map((step) => step.key).join(",");

function meta(key: RunnerKey, machines: Machine[]) {
  if (key === "github") return "Runs on the label the job sets in relay.yml's github input.";
  const active = machines.filter((machine) => !machine.revokedAt);
  const count = active.length;
  const paused = active.filter((machine) => machine.paused).length;
  return `${count} ${count === 1 ? "machine" : "machines"}${paused ? ` · ${paused} paused` : ""} · spread by least recently picked · never for public repos`;
}

function ProviderSection({
  providerKey,
  meta,
  position,
  editable,
  canMoveUp,
  canMoveDown,
  canRemove,
  onMove,
  onRemove,
  children,
}: {
  providerKey: RunnerKey;
  meta: string;
  position: number;
  editable: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: providerKey, disabled: !editable });
  const label = RUNNER_LABELS[providerKey];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "overflow-hidden rounded-lg border bg-background",
        isDragging && "relative z-10 shadow-lg ring-1 ring-ring/40",
      )}
    >
      <div className="flex items-center gap-2 bg-secondary px-2.5 py-2 sm:gap-3">
        {editable && (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Drag ${label}`}
            className="hidden size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing sm:flex"
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon aria-hidden className="size-4" />
          </button>
        )}
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground tabular-nums">
          {position}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Move ${label} up`}
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Move ${label} down`}
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${label} from the order`}
              title={canRemove ? undefined : "The order needs at least one provider."}
              disabled={!canRemove}
              onClick={onRemove}
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {children && <div className="grid gap-2 border-t p-2">{children}</div>}
    </li>
  );
}

/** A provider left out of the order: jobs never run there. Its runners still show. */
function UnusedSection({
  providerKey,
  onAdd,
  children,
}: {
  providerKey: RunnerKey;
  /** Missing for members, who can't change the order. */
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-dashed">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="grid gap-0.5">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {RUNNER_LABELS[providerKey]}
          </h2>
          <p className="text-xs text-muted-foreground">Not in the order. Jobs never run here.</p>
        </div>
        {onAdd && (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <PlusIcon aria-hidden />
            Add to order
          </Button>
        )}
      </div>
      {children && (
        <div className="grid gap-2 border-t border-dashed p-2 opacity-70">{children}</div>
      )}
    </div>
  );
}

function MachineList({ machines }: { machines: Machine[] }) {
  if (machines.length === 0) {
    return (
      <Card className="py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium">No machines yet</CardTitle>
          <CardDescription>
            Run <code className="font-mono">npx relayrunner connect</code> on a laptop or server to
            add it.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return machines.map((machine) => <MachineCard key={machine.id} machine={machine} />);
}

function MachineCard({ machine }: { machine: Machine }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<"revoke" | "pause" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "revoke" | "pause" | "resume") {
    setPending(action);
    setError(null);
    try {
      if (action === "revoke") await revokeMachine(machine.id);
      else if (action === "pause") await pauseMachine(machine.id);
      else await resumeMachine(machine.id);
      await router.invalidate();
      if (action !== "revoke") setPending(null);
    } catch {
      setError(`Couldn't ${action} the machine. Try again.`);
      setPending(null);
    }
  }

  async function copyLabels() {
    try {
      await navigator.clipboard.writeText((machine.labels ?? []).join(", "));
    } catch {
      // Clipboard can be blocked; the chips are still readable and copy one at a time.
    }
  }

  // Previews talk to the production API, which may not send status yet: read that as offline.
  const status = machine.status ?? { online: false, state: null, connectedAt: null };
  const paused = machine.paused ?? null;
  const live = paused
    ? pausedBadge(status)
    : machineBadge[status.online ? (status.state ?? "idle") : "offline"];
  const seen = paused
    ? pausedLine(paused, status)
    : status.online
      ? status.connectedAt && `Connected ${timeAgo(status.connectedAt)}`
      : machine.lastSeenAt
        ? `Last seen ${timeAgo(machine.lastSeenAt)}`
        : "Never connected";

  return (
    <Card className={cn("py-4", paused && "border-run-edge/60")}>
      <CardHeader className="px-4">
        <CardTitle className="self-center font-mono text-sm font-medium">{machine.name}</CardTitle>
        {/* Full width under the name and the actions, so a long paused line fits on a phone. */}
        <CardDescription className="col-span-2">
          {seen || "Your machine"}
          {error && <span className="block text-destructive">{error}</span>}
        </CardDescription>
        <CardAction className="row-span-1 flex items-center gap-2">
          <Badge variant={live.variant}>{live.label}</Badge>
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending !== null}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending !== null}
                onClick={() => void act("revoke")}
              >
                {pending === "revoke" ? "Revoking…" : "Revoke"}
              </Button>
            </>
          ) : (
            <>
              {/* Pausing is rare and lives in the menu; resuming is the one thing a paused
                  machine needs, so it gets the button. */}
              {paused && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => void act("resume")}
                >
                  <PlayIcon aria-hidden />
                  {/* Icon only on a phone, so the badge and the name keep their room. */}
                  <span className="sr-only sm:not-sr-only">
                    {pending === "resume" ? "Resuming…" : "Resume"}
                  </span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`More actions for ${machine.name}`}
                    disabled={pending !== null}
                  >
                    <EllipsisIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  {paused ? (
                    <DropdownMenuItem onSelect={() => void act("resume")}>
                      <PlayIcon aria-hidden />
                      Resume
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => void act("pause")}>
                      <PauseIcon aria-hidden />
                      <span className="grid">
                        <span>Pause</span>
                        <span className="text-xs text-muted-foreground">
                          Stay connected, skip new jobs
                        </span>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {machine.labels && machine.labels.length > 0 && (
                    <DropdownMenuItem onSelect={() => void copyLabels()}>
                      <CopyIcon aria-hidden />
                      Copy labels
                    </DropdownMenuItem>
                  )}
                  {/* Members revoke only the machines they enrolled; the API says which. */}
                  {machine.canRevoke !== false && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
                        <BanIcon aria-hidden />
                        Revoke…
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </CardAction>
        {/* Full width under the name and the actions, so the chips have room on a phone. */}
        {machine.labels && machine.labels.length > 0 && (
          <MachineLabels labels={machine.labels} dimmed={paused !== null} />
        )}
      </CardHeader>
    </Card>
  );
}

// A paused machine's badge: still online or not, and whether it's finishing a job.
function pausedBadge(status: { online: boolean; state: "idle" | "busy" | null }) {
  if (!status.online) return { variant: "paused", label: "Offline · Paused" } as const;
  if (status.state === "busy")
    return { variant: "paused", label: "Paused · Finishing job" } as const;
  return { variant: "paused", label: "Online · Paused" } as const;
}

function pausedLine(
  paused: { at: string; by: string | null },
  status: { online: boolean; state: "idle" | "busy" | null },
) {
  const who = paused.by ? `Paused by ${paused.by}` : "Paused from its CLI";
  const then =
    status.online && status.state === "busy"
      ? "finishing its job, then no new jobs"
      : "jobs skip it until it's resumed";
  return `${who} ${timeAgo(paused.at)} · ${then}`;
}

// The labels a job's `machine:` input matches. Clicking one copies it.
function MachineLabels({ labels, dimmed = false }: { labels: string[]; dimmed?: boolean }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string) {
    try {
      await navigator.clipboard.writeText(label);
      setCopied(label);
      setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the label is still readable.
    }
  }

  return (
    <ul
      className={cn("col-span-2 flex flex-wrap items-center gap-1.5", dimmed && "opacity-60")}
      aria-label="Labels"
    >
      {labels.map((label) => (
        <li key={label} className="flex">
          <Badge asChild variant="outline" className="font-mono font-normal">
            <button
              type="button"
              className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
              title="Copy label"
              aria-label={copied === label ? `Copied ${label}` : `Copy ${label}`}
              onClick={() => void copy(label)}
            >
              {copied === label && <CheckIcon />}
              {label}
            </button>
          </Badge>
        </li>
      ))}
    </ul>
  );
}
