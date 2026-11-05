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
  CheckIcon,
  GripVerticalIcon,
  InfoIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AddRunner } from "@/components/add-runner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authDisabled } from "@/lib/auth-client";
import { listMachines, revokeMachine, timeAgo, type Machine } from "@/lib/machines";
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
        Jobs try these providers from top to bottom. Move a section to change the order.
      </PageHeader>
      <div className="grid max-w-3xl gap-3">
        <div className="flex items-start gap-2.5 rounded-lg border border-run-edge bg-run/10 px-3.5 py-2.5 text-sm">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-run" />
          <p>
            Routing doesn't use this order yet. Until it does, jobs go to a free local machine
            first, then GitHub-hosted.
          </p>
        </div>

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
          <UnusedSection key={key} providerKey={key} onAdd={() => change([...steps, { key }])}>
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
  const count = machines.filter((machine) => !machine.revokedAt).length;
  return `${count} ${count === 1 ? "machine" : "machines"} · spread by least recently picked · never for public repos`;
}

function ProviderSection({
  providerKey,
  meta,
  position,
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
  } = useSortable({ id: providerKey });
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
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs text-muted-foreground tabular-nums">
          {position}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
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
  onAdd: () => void;
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
        <Button size="sm" variant="outline" onClick={onAdd}>
          <PlusIcon aria-hidden />
          Add to order
        </Button>
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setPending(true);
    setError(null);
    try {
      await revokeMachine(machine.id);
      await router.invalidate();
    } catch {
      setError("Couldn't revoke the machine. Try again.");
      setPending(false);
    }
  }

  // Previews talk to the production API, which may not send status yet: read that as offline.
  const status = machine.status ?? { online: false, state: null, connectedAt: null };
  const live = machineBadge[status.online ? (status.state ?? "idle") : "offline"];
  const seen = status.online
    ? status.connectedAt && `Connected ${timeAgo(status.connectedAt)}`
    : machine.lastSeenAt
      ? `Last seen ${timeAgo(machine.lastSeenAt)}`
      : "Never connected";

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <div className="grid gap-1">
          <CardTitle className="font-mono text-sm font-medium">{machine.name}</CardTitle>
          <CardDescription>
            {seen || "Your machine"}
            {error && <span className="block text-destructive">{error}</span>}
          </CardDescription>
        </div>
        <CardAction className="row-span-1 flex items-center gap-2">
          <Badge variant={live.variant}>{live.label}</Badge>
          {confirming ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => void revoke()}
              >
                {pending ? "Revoking…" : "Revoke"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          )}
        </CardAction>
        {/* Full width under the name and the actions, so the chips have room on a phone. */}
        {machine.labels && machine.labels.length > 0 && <MachineLabels labels={machine.labels} />}
      </CardHeader>
    </Card>
  );
}

// The labels a job's `machine:` input matches. Clicking one copies it.
function MachineLabels({ labels }: { labels: string[] }) {
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
    <ul className="col-span-2 flex flex-wrap items-center gap-1.5" aria-label="Labels">
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
