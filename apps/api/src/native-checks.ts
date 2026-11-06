// Native checks: small checks a PickRunner answers itself, with no VM and no billed minute. A job
// is a native check when its steps use a check action from relayrunner/actions, such as
// `uses: relayrunner/actions/checks/pr-title@v1`. The action also runs as an ordinary action, so
// the same job still works if it's pointed at any other runner.

import { dictionary, isRecord, scalar } from "./routing.ts";

const CHECKS_REPO = "relayrunner/actions";
const CHECKS_PATH = "checks/";

export type CheckName = "pr-title";
const CHECKS: readonly CheckName[] = ["pr-title"];

export interface CheckStep {
  check: CheckName;
  inputs: Record<string, string>;
}

// What a claimed job asks for: nothing native (route it as a pick), checks we can run, or checks
// we can't run here, with the reason the job fails with.
export type NativeJob =
  | { kind: "none" }
  | { kind: "checks"; steps: CheckStep[] }
  | { kind: "unsupported"; reason: string };

export type CheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Reads the job message's steps. A job with no relayrunner check step is not native. A job with
 * one must be all check steps with literal inputs, since a Worker can't run anything else.
 */
export function nativeJob(steps: unknown): NativeJob {
  if (!Array.isArray(steps)) return { kind: "none" };
  const references = steps.map(checkReference);
  if (!references.some((reference) => reference !== null)) return { kind: "none" };

  const checks: CheckStep[] = [];
  for (const [index, step] of steps.entries()) {
    const reference = references[index];
    if (reference === null)
      return {
        kind: "unsupported",
        reason: `RelayRunner runs a job natively only when every step is a RelayRunner check. Step ${index + 1} (${stepLabel(step)}) isn't, so move it to another job or route this job with the relay.`,
      };
    if (!CHECKS.includes(reference as CheckName))
      return {
        kind: "unsupported",
        reason: `RelayRunner doesn't run the \`${reference}\` check natively yet.`,
      };
    const inputs = literalInputs(isRecord(step) ? step.inputs : undefined);
    if (!inputs)
      return {
        kind: "unsupported",
        reason: `The \`${reference}\` check takes only literal inputs when RelayRunner runs it natively.`,
      };
    checks.push({ check: reference as CheckName, inputs });
  }
  return { kind: "checks", steps: checks };
}

export function runCheck(step: CheckStep, contextData: unknown): CheckResult {
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
export const DEFAULT_TYPES = [
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

const CONVENTIONAL = /^(?<type>[A-Za-z]+)(?:\((?<scope>[^()\r\n]+)\))?!?: (?<description>\S.*)$/;
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
  const github = dictionary(isRecord(contextData) ? contextData.github : undefined);
  const event = dictionary(github?.get("event"));
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
