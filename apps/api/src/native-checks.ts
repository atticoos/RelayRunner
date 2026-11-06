// Native checks: small checks a PickRunner answers itself, with no VM and no billed minute. A job
// is a native check when its steps use a check action from relayrunner/actions, such as
// `uses: relayrunner/actions/checks/pr-title@v1`. The action also runs as an ordinary action, so
// the same job still works if it's pointed at any other runner.

import { context, dictionary, isRecord, scalar } from "./pipeline-context.ts";

const CHECKS_REPO = "relayrunner/actions";
const CHECKS_PATH = "checks/";

const CHECKS = ["pr-title"] as const;
export type CheckName = (typeof CHECKS)[number];
const isCheckName = (name: string): name is CheckName =>
  (CHECKS as readonly string[]).includes(name);

export interface CheckStep {
  check: CheckName;
  inputs: Record<string, string>;
}

// What a native job asks for: checks we can run, or checks we can't run here, with the reason the
// job fails with.
export type NativeJob =
  | { kind: "checks"; steps: CheckStep[] }
  | { kind: "unsupported"; reason: string };

export type CheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Reads the job message's steps. A job with no relayrunner check step is not native (null). A job
 * with one must be all check steps with literal inputs, since a Worker can't run anything else.
 */
export function nativeJob(steps: unknown): NativeJob | null {
  if (!Array.isArray(steps)) return null;
  const parsed = steps.map((step) => ({ step, check: checkReference(step) }));
  if (parsed.every(({ check }) => check === null)) return null;

  const checks: CheckStep[] = [];
  for (const [index, { step, check }] of parsed.entries()) {
    if (check === null)
      return {
        kind: "unsupported",
        reason: `RelayRunner runs a job natively only when every step is a RelayRunner check. Step ${index + 1} (${stepLabel(step)}) isn't, so move it to another job or route this job with the relay.`,
      };
    if (!isCheckName(check))
      return {
        kind: "unsupported",
        reason: `RelayRunner doesn't run the \`${check}\` check natively yet.`,
      };
    const inputs = literalInputs(isRecord(step) ? step.inputs : undefined);
    if (!inputs)
      return {
        kind: "unsupported",
        reason: `The \`${check}\` check takes only literal inputs when RelayRunner runs it natively.`,
      };
    checks.push({ check, inputs });
  }
  return { kind: "checks", steps: checks };
}

/**
 * The verdict for a claimed job: null when it isn't native (route it as a pick), otherwise the
 * checks it ran and whether they passed. A job we can't run natively fails with the reason.
 */
export function nativeVerdict(
  steps: unknown,
  contextData: unknown,
): { checks: CheckName[]; result: CheckResult } | null {
  const job = nativeJob(steps);
  if (!job) return null;
  if (job.kind === "unsupported") return { checks: [], result: { ok: false, reason: job.reason } };
  return { checks: job.steps.map((step) => step.check), result: runChecks(job.steps, contextData) };
}

function runCheck(step: CheckStep, contextData: unknown): CheckResult {
  switch (step.check) {
    case "pr-title": {
      const title = pullRequestTitle(contextData);
      if (title === null)
        return {
          ok: false,
          reason:
            "The pr-title check reads the pull request's title, so run it on pull_request events.",
        };
      return checkConventionalTitle(title, parseList(step.inputs.types));
    }
  }
}

/** Runs each check in order and stops at the first failure. */
export function runChecks(steps: CheckStep[], contextData: unknown): CheckResult {
  for (const step of steps) {
    const result = runCheck(step, contextData);
    if (!result.ok) return result;
  }
  return { ok: true };
}

// The types AGENTS.md allows, which are the Conventional Commits defaults from commitlint.
const DEFAULT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const CONVENTIONAL = /^(?<type>[A-Za-z]+)(?:\([^()\r\n]+\))?!?: \S.*$/;
const EXAMPLE = "feat(api): add native checks";

/** Whether a title has the Conventional Commits shape `type(scope)!: description`. */
export function checkConventionalTitle(title: string, types: string[] = []): CheckResult {
  const allowed = types.length > 0 ? types : DEFAULT_TYPES;
  const match = CONVENTIONAL.exec(title.trim());
  if (!match?.groups)
    return {
      ok: false,
      reason: `The pull request title "${title}" isn't a Conventional Commit. Write it as type(scope): description, such as "${EXAMPLE}".`,
    };
  const type = match.groups.type;
  if (!allowed.includes(type))
    return {
      ok: false,
      reason: `The pull request title uses the type "${type}". Use one of: ${allowed.join(", ")}.`,
    };
  return { ok: true };
}

// `relayrunner/actions/checks/<name>` on any ref, or null for any other step.
function checkReference(step: unknown): string | null {
  if (!isRecord(step) || !isRecord(step.reference)) return null;
  const { name, path } = step.reference;
  if (typeof name !== "string" || name.toLowerCase() !== CHECKS_REPO) return null;
  if (typeof path !== "string") return null;
  const trimmed = path.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (!trimmed.startsWith(CHECKS_PATH)) return null;
  const check = trimmed.slice(CHECKS_PATH.length);
  return check && !check.includes("/") ? check : null;
}

function stepLabel(step: unknown) {
  if (!isRecord(step)) return "unknown";
  const name = literal(step.displayName) ?? literal(step.name);
  if (name) return name;
  const reference = isRecord(step.reference) ? step.reference : undefined;
  if (reference && typeof reference.name === "string")
    return reference.path ? `${reference.name}/${reference.path}` : reference.name;
  return "a run step";
}

// A step's `inputs` is a template mapping token: {type: 2, map: [{Key, Value}]}, where each key
// and value is a bare string or a string token {type: 0, lit}. An expression ({type: 3, expr}) or
// any other token can't be evaluated here, so the inputs read as null.
function literalInputs(token: unknown): Record<string, string> | null {
  if (token === undefined || token === null) return {};
  if (!isRecord(token) || !Array.isArray(token.map)) return null;
  const inputs: Record<string, string> = {};
  for (const pair of token.map) {
    if (!isRecord(pair)) return null;
    const key = literal(pair.Key ?? pair.key);
    const value = literal(pair.Value ?? pair.value);
    if (key === null || value === null) return null;
    inputs[key] = value;
  }
  return inputs;
}

function literal(token: unknown): string | null {
  if (typeof token === "string") return token;
  if (isRecord(token) && typeof token.lit === "string") return token.lit;
  return null;
}

// `github.event.pull_request.title` from the job's PipelineContextData.
export function pullRequestTitle(contextData: unknown): string | null {
  const event = dictionary(context(contextData, "github")?.get("event"));
  const pullRequest = dictionary(event?.get("pull_request"));
  const title = scalar(pullRequest?.get("title"));
  return typeof title === "string" ? title : null;
}

// Comma- or newline-separated, as commitlint-style actions take lists.
function parseList(value: string | undefined) {
  return (value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
