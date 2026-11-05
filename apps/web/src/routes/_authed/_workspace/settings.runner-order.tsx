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
  runnerOrderSchema,
  type RunnerKey,
  type RunnerStep,
} from "@relayrunner/runner-order";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  InfoIcon,
  LaptopIcon,
  PlusIcon,
  ServerIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { authDisabled } from "@/lib/auth-client";
import { listMachines, type Machine } from "@/lib/machines";
import { RunnerOrderError, getRunnerOrder, saveRunnerOrder } from "@/lib/runner-order";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_workspace/settings/runner-order")({
  loader: async ({ context }) => {
    const id = context.current.workspace.id;
    try {
      const [order, { machines }] = await Promise.all([getRunnerOrder(id), listMachines()]);
      return { ...order, machines };
    } catch (error) {
      // The dev preview has no API behind it: show the default order.
      if (authDisabled) return { order: DEFAULT_RUNNER_ORDER, isDefault: true, machines: [] };
      throw error;
    }
  },
  component: RunnerOrderPage,
});

function RunnerOrderPage() {
  const loaded = Route.useLoaderData();
  const { current } = Route.useRouteContext();
  const [saved, setSaved] = useState({ steps: loaded.order.steps, isDefault: loaded.isDefault });
  const [steps, setSteps] = useState<RunnerStep[]>(loaded.order.steps);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const dirty = keys(steps) !== keys(saved.steps);
  const valid = runnerOrderSchema.safeParse({ steps });
  const missing = RUNNER_KEYS.filter((key) => !steps.some((step) => step.key === key));
  const pool = loaded.machines.filter((machine) => !machine.revokedAt);

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

  return (
    <section>
      <PageHeader title="Runner order">
        The providers your jobs may run on, in the order they're tried.
      </PageHeader>
      <div className="grid max-w-3xl gap-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-run-edge bg-run/10 px-3.5 py-2.5 text-sm">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-run" />
          <p>
            Routing doesn't use this order yet. Until it does, jobs go to a free local machine
            first, then GitHub-hosted.
          </p>
        </div>

        <Card className="gap-0 py-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Order</h2>
            {saved.isDefault && !dirty && <Badge variant="idle">Default</Badge>}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={steps.map((step) => step.key)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="grid gap-2 p-2">
                {steps.map((step, index) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    position={index + 1}
                    pool={pool}
                    canMoveUp={index > 0}
                    canMoveDown={index < steps.length - 1}
                    canRemove={steps.length > 1}
                    onMove={(by) => change(arrayMove(steps, index, index + by))}
                    onRemove={() => change(steps.filter((_, i) => i !== index))}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          {missing.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {missing.map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant="outline"
                  onClick={() => change([...steps, { key }])}
                >
                  <PlusIcon aria-hidden />
                  Add {RUNNER_LABELS[key]}
                </Button>
              ))}
            </div>
          )}
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">
            Jobs use the first provider here that they configure and that can take them. Jobs
            nothing fits won't run.
          </p>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!dirty || !valid.success || status.kind === "saving"}
            onClick={() => void save()}
          >
            {status.kind === "saving" ? "Saving…" : "Save order"}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => change(saved.steps)}>
              Discard changes
            </Button>
          )}
          <span role="status" className="text-sm">
            {status.kind === "saved" && <span className="text-muted-foreground">Order saved.</span>}
            {status.kind === "error" && <span className="text-destructive">{status.message}</span>}
          </span>
        </div>
      </div>
    </section>
  );
}

const keys = (steps: RunnerStep[]) => steps.map((step) => step.key).join(",");

const stepIcon: Record<RunnerKey, typeof LaptopIcon> = { machine: LaptopIcon, github: ServerIcon };

function StepRow({
  step,
  position,
  pool,
  canMoveUp,
  canMoveDown,
  canRemove,
  onMove,
  onRemove,
}: {
  step: RunnerStep;
  position: number;
  pool: Machine[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.key });
  const label = RUNNER_LABELS[step.key];
  const Icon = stepIcon[step.key];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md border border-border bg-secondary p-2.5 sm:gap-3",
        isDragging && "relative z-10 shadow-lg ring-1 ring-ring/40",
      )}
    >
      <div className="flex items-center gap-1 pt-0.5">
        <button
          ref={setActivatorNodeRef}
          type="button"
          aria-label={`Drag ${label}`}
          className="flex size-7 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon aria-hidden className="size-4" />
        </button>
        <span className="w-4 font-mono text-xs text-muted-foreground tabular-nums">{position}</span>
      </div>

      <div className="grid min-w-0 gap-1 pt-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {label}
        </span>
        {step.key === "machine" ? <PoolDetail pool={pool} /> : <GithubDetail />}
      </div>

      <div className="flex items-center">
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
          aria-label={`Remove ${label}`}
          title={canRemove ? undefined : "The order needs at least one provider."}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
    </li>
  );
}

function PoolDetail({ pool }: { pool: Machine[] }) {
  if (pool.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No machines yet. Run <code className="font-mono">npx relayrunner connect</code> to add one.
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {pool.length} {pool.length === 1 ? "machine" : "machines"} · spread by least recently picked
        · never for public repos
      </p>
      <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Machines in the pool">
        {pool.map((machine) => {
          const online = machine.status?.online ?? false;
          return (
            <li
              key={machine.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  online ? "bg-go" : "border border-muted-foreground",
                )}
              />
              <span className="truncate">{machine.name}</span>
              <span className="sr-only">{online ? "online" : "offline"}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// Where the minutes rule (#117) will sit.
function GithubDetail() {
  return (
    <p className="text-xs text-muted-foreground">
      Runs on the label the job sets in relay.yml's <code className="font-mono">github</code> input.
    </p>
  );
}
