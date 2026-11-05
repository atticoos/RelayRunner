import type { RouteWalk, SkipReason } from "@relayrunner/activity";
import type { RunnerKey } from "@relayrunner/runner-order";

// How the Activity page explains where a job went: a short reason after the runner, and one line
// per step when the reason is opened. Worded here from the stored walk, so the copy can change
// without touching stored data.

export type { RouteWalk } from "@relayrunner/activity";

const ANY_MACHINE = "self-hosted";

// `machine: self-hosted` asks for any machine, so its labels add nothing to the sentence.
function machineLabels(walk: RouteWalk) {
  const labels = walk.machine.filter((label) => label.toLowerCase() !== ANY_MACHINE);
  return labels.length ? labels.join(", ") : null;
}

function shortSkip(walk: RouteWalk, reason: SkipReason): string | null {
  switch (reason) {
    case "no_machine": {
      const labels = machineLabels(walk);
      return labels ? `no idle machine with ${labels}` : "no idle machine";
    }
    case "public_repo":
      return "public repo";
    case "too_many_labels":
      return "github takes one label";
    case "not_configured":
      // Leaving a provider out of the relay is a choice, not news.
      return null;
  }
}

function longSkip(walk: RouteWalk, key: RunnerKey, reason: SkipReason): string {
  switch (reason) {
    case "no_machine": {
      const labels = machineLabels(walk);
      return labels
        ? `no machine with ${labels} was online and idle`
        : "no machine was online and idle";
    }
    case "public_repo":
      return "public repos never run on local machines";
    case "too_many_labels":
      return `github takes one label, not ${walk.github.join(", ")}`;
    case "not_configured":
      return `the relay doesn't set ${key}`;
  }
}

export type WalkTone = "fallback" | "info";

/**
 * The short reason shown after a routed job's runner, or null when there's nothing to say (the
 * first step the relay set took it, and nothing it set was ignored). `fallback` when a step the
 * relay asked for couldn't take the job.
 */
export function walkSummary(walk: RouteWalk): { text: string; tone: WalkTone } | null {
  const parts: string[] = [];
  let tone: WalkTone = "info";
  for (const { reason } of walk.skipped) {
    const text = shortSkip(walk, reason);
    if (text) parts.push(text);
    if (reason === "no_machine" || reason === "too_many_labels") tone = "fallback";
  }
  for (const key of walk.notInOrder) parts.push(`${key} is set but not in your order`);
  return parts.length ? { text: parts.join("; "), tone } : null;
}

export interface WalkLine {
  // The step's place in the runner order, or null for a provider outside it.
  position: number | null;
  key: RunnerKey;
  state: "skipped" | "ran" | "not_tried";
  text: string;
}

/**
 * One line per step the pick looked at, in order, then the providers the order leaves out.
 * `runner` names where the answering step sent the job: its line reads "on <runner>".
 */
export function walkLines(walk: RouteWalk, runner: string | null): WalkLine[] {
  const lines: WalkLine[] = walk.skipped.map(({ key, reason }, index) => ({
    position: index + 1,
    key,
    state: "skipped",
    text: longSkip(walk, key, reason),
  }));
  if (walk.step)
    lines.push({
      position: lines.length + 1,
      key: walk.step,
      state: "ran",
      text: runner ? `on ${runner}` : "",
    });
  for (const key of walk.notInOrder)
    lines.push({ position: null, key, state: "not_tried", text: "not in your runner order" });
  return lines;
}

export const NO_RUNNER_PREFIX = "No runner available: ";

/** A failed relay's message without the "No runner available:" GitHub shows it with. */
export function failureText(reason: string) {
  const text = reason.startsWith(NO_RUNNER_PREFIX) ? reason.slice(NO_RUNNER_PREFIX.length) : reason;
  return text.replace(/`/g, "").replace(/\.$/, "");
}
