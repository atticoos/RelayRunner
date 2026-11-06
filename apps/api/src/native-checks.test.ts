import { describe, expect, test } from "vitest";
import {
  checkConventionalTitle,
  nativeJob,
  nativeVerdict,
  pullRequestTitle,
  runChecks,
  type CheckStep,
} from "./native-checks.ts";

// A step as the job message carries it: the runner's ActionStep JSON.
const checkStep = (path: string, inputs?: unknown) => ({
  type: "action",
  reference: {
    type: "repository",
    name: "relayrunner/actions",
    ref: "v1",
    repositoryType: "GitHub",
    path,
  },
  ...(inputs === undefined ? {} : { inputs }),
});
const runStep = {
  type: "action",
  reference: { type: "script" },
  displayName: "Run pnpm lint",
  inputs: { type: 2, map: [{ Key: "script", Value: "pnpm lint" }] },
};

// PipelineContextData: a dictionary is {t: 2, d: [{k, v}]}.
const dict = (entries: Record<string, unknown>) => ({
  t: 2,
  d: Object.entries(entries).map(([k, v]) => ({ k, v })),
});
const prContext = (title: string) => ({
  github: dict({
    repository: "relayrunner/relayrunner",
    event_name: "pull_request",
    event: dict({ action: "opened", pull_request: dict({ number: { t: 4, n: 7 }, title }) }),
  }),
});

describe("nativeJob", () => {
  test("a job with no RelayRunner check step is routed as a pick", () => {
    expect(nativeJob([runStep])).toBeNull();
    expect(nativeJob(undefined)).toBeNull();
    expect(
      nativeJob([{ reference: { type: "repository", name: "actions/checkout", path: "" } }]),
    ).toBeNull();
  });

  test("reads check steps and their literal inputs", () => {
    expect(
      nativeJob([
        checkStep("checks/pr-title", {
          type: 2,
          map: [{ Key: "types", Value: { type: 0, lit: "feat,fix" } }],
        }),
      ]),
    ).toEqual({ kind: "checks", steps: [{ check: "pr-title", inputs: { types: "feat,fix" } }] });
    expect(nativeJob([checkStep("/Checks/PR-Title/")])).toEqual({
      kind: "checks",
      steps: [{ check: "pr-title", inputs: {} }],
    });
  });

  test("refuses a job that mixes checks with other steps", () => {
    const job = nativeJob([checkStep("checks/pr-title"), runStep]);
    expect(job?.kind).toBe("unsupported");
    expect(job?.kind === "unsupported" && job.reason).toContain("Step 2 (Run pnpm lint)");
  });

  test("refuses a check it doesn't know", () => {
    expect(nativeJob([checkStep("checks/typecheck")])).toEqual({
      kind: "unsupported",
      reason: "RelayRunner doesn't run the `typecheck` check natively yet.",
    });
  });

  test("refuses inputs that need an expression", () => {
    const job = nativeJob([
      checkStep("checks/pr-title", {
        type: 2,
        map: [{ Key: "types", Value: { type: 3, expr: "vars.TYPES" } }],
      }),
    ]);
    expect(job?.kind).toBe("unsupported");
  });
});

describe("checkConventionalTitle", () => {
  test.each([
    "feat(api): add native checks",
    "fix: handle a missing title",
    "feat(api)!: drop the old relay",
    "chore(cli): release relayrunner 0.2.0",
  ])("passes %s", (title) => {
    expect(checkConventionalTitle(title)).toEqual({ ok: true });
  });

  test.each(["Add native checks", "feat add native checks", "feat(api):add", "feat(): add", ""])(
    "fails %j",
    (title) => {
      const result = checkConventionalTitle(title);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain("isn't a Conventional Commit");
    },
  );

  test("fails a type that isn't allowed and names the allowed ones", () => {
    expect(checkConventionalTitle("feature: add checks")).toEqual({
      ok: false,
      reason:
        'The pull request title uses the type "feature". Use one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.',
    });
    expect(checkConventionalTitle("feat: add checks", ["fix", "docs"]).ok).toBe(false);
    expect(checkConventionalTitle("docs: add checks", ["fix", "docs"]).ok).toBe(true);
  });
});

describe("runChecks", () => {
  const prTitle: CheckStep = { check: "pr-title", inputs: {} };

  test("reads the title from the job's github context", () => {
    expect(pullRequestTitle(prContext("feat: x"))).toBe("feat: x");
    expect(runChecks([prTitle], prContext("feat(api): add native checks"))).toEqual({ ok: true });
    expect(runChecks([prTitle], prContext("Add native checks")).ok).toBe(false);
  });

  test("honours the types input", () => {
    const docsOnly: CheckStep = { check: "pr-title", inputs: { types: "docs\nci" } };
    expect(runChecks([docsOnly], prContext("ci: run checks")).ok).toBe(true);
    expect(runChecks([docsOnly], prContext("feat: run checks")).ok).toBe(false);
  });

  test("fails outside a pull request event", () => {
    const push = { github: dict({ event_name: "push", event: dict({ ref: "refs/heads/main" }) }) };
    expect(runChecks([prTitle], push)).toEqual({
      ok: false,
      reason:
        "The pr-title check reads the pull request's title, so run it on pull_request events.",
    });
  });
});

describe("nativeVerdict", () => {
  test("is null for a job that isn't native", () => {
    expect(nativeVerdict([runStep], prContext("feat: x"))).toBeNull();
  });

  test("runs the checks and names them", () => {
    expect(nativeVerdict([checkStep("checks/pr-title")], prContext("feat: x"))).toEqual({
      checks: ["pr-title"],
      result: { ok: true },
    });
  });

  test("fails a job it can't run natively with the reason", () => {
    expect(nativeVerdict([checkStep("checks/typecheck")], prContext("feat: x"))).toEqual({
      checks: [],
      result: { ok: false, reason: "RelayRunner doesn't run the `typecheck` check natively yet." },
    });
  });
});
