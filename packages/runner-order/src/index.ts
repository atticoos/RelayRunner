import { z } from "zod";

// A workspace's runner order: an ordered allowlist of providers. The Router walks it top to
// bottom and a job goes to the first provider that the job configures (relay.yml's `machine`,
// `github` and `blacksmith` inputs) and that can take it. A provider missing from the order is never picked,
// and a job nothing fits fails fast. Labels come from the job, so a step is only a key. Rules
// per step (e.g. "while included minutes remain", #117) get added to the step objects later.

/** Every provider a step can name, in the order the dashboard offers them. */
export const RUNNER_KEYS = ["machine", "github", "blacksmith"] as const;
export type RunnerKey = (typeof RUNNER_KEYS)[number];

export const runnerStepSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("machine") }),
  z.object({ key: z.literal("github") }),
  z.object({ key: z.literal("blacksmith") }),
]);
export type RunnerStep = z.infer<typeof runnerStepSchema>;

export const runnerOrderSchema = z.object({
  steps: z
    .array(runnerStepSchema)
    .min(1, "Add at least one provider.")
    .superRefine((steps, ctx) => {
      const seen = new Set<RunnerKey>();
      steps.forEach((step, index) => {
        if (seen.has(step.key)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "key"],
            message: `${RUNNER_LABELS[step.key]} is already in the order.`,
          });
        }
        seen.add(step.key);
      });
    }),
});
export type RunnerOrder = z.infer<typeof runnerOrderSchema>;

/** What a workspace that never saved an order gets: a free local machine, then GitHub-hosted. */
export const DEFAULT_RUNNER_ORDER: RunnerOrder = {
  steps: [{ key: "machine" }, { key: "github" }],
};

/** How the dashboard names each provider. */
export const RUNNER_LABELS: Record<RunnerKey, string> = {
  machine: "Self-hosted",
  github: "GitHub-hosted",
  blacksmith: "Blacksmith",
};

/**
 * The stored column's value as an order. A missing or unreadable value reads as the default,
 * so routing never stalls on a bad row.
 */
export function readRunnerOrder(stored: string | null | undefined): RunnerOrder {
  if (!stored) return DEFAULT_RUNNER_ORDER;
  try {
    const parsed = runnerOrderSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : DEFAULT_RUNNER_ORDER;
  } catch {
    return DEFAULT_RUNNER_ORDER;
  }
}
