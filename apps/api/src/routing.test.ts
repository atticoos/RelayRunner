import type { RunnerOrder } from "@relayrunner/runner-order";
import { describe, expect, test, vi } from "vitest";
import {
  canClaim,
  chooseMachine,
  decideRoute,
  holdsMachine,
  jobContext,
  hasLabels,
  lastPicked,
  machineLabels,
  machineRunnerName,
  newRouteId,
  parseLabels,
  ROUTE_HOLD_MS,
  routeIdFromLabels,
  routeLabel,
  type Route,
} from "./routing.ts";

const route: Route = {
  id: "0123456789ab",
  machineId: "m1",
  machineName: "Atticus's MacBook",
  installationId: 7,
  repo: "relayrunner/relayrunner-ci-tests",
  repositoryId: 100,
  runId: 9,
  createdAt: 1_000,
  state: "reserved",
};

describe("route labels", () => {
  test("a new route's label reads back as its id", () => {
    const id = newRouteId();
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(routeIdFromLabels(["self-hosted", routeLabel(id)])).toBe(id);
  });

  test("ignores case, and anything that isn't a route label, including rr-test", () => {
    expect(routeIdFromLabels(["RR-0123456789AB"])).toBe("0123456789ab");
    expect(routeIdFromLabels(["rr-test", "relayrunner", "ubuntu-latest", "rr-0123"])).toBeNull();
  });
});

describe("chooseMachine", () => {
  const machine = (
    id: string,
    online: boolean,
    state: "idle" | "busy" | null,
    labels = ["self-hosted", "macOS", "ARM64"],
  ) => ({ id, name: id, online, state, labels });

  test("picks an online, idle machine no route holds", () => {
    const picked = chooseMachine(
      [
        machine("offline", false, null),
        machine("busy", true, "busy"),
        machine("held", true, "idle"),
        machine("free", true, "idle"),
      ],
      new Set(["held"]),
    );
    expect(picked?.id).toBe("free");
  });

  test("returns null when no machine is free", () => {
    expect(chooseMachine([machine("busy", true, "busy")], new Set())).toBeNull();
    expect(chooseMachine([machine("held", true, "idle")], new Set(["held"]))).toBeNull();
    expect(chooseMachine([], new Set())).toBeNull();
  });

  test("prefers a machine never picked, then the least recently picked", () => {
    const candidates = [
      machine("a", true, "idle"),
      machine("b", true, "idle"),
      machine("c", true, "idle"),
    ];
    const picked = new Map([
      ["a", 3_000],
      ["b", 1_000],
    ]);
    expect(chooseMachine(candidates, new Set(), picked)?.id).toBe("c");
    expect(chooseMachine(candidates.slice(0, 2), new Set(), picked)?.id).toBe("b");
  });

  test("skips held, busy and offline machines even when picked longest ago", () => {
    const picked = new Map([
      ["held", 1],
      ["busy", 1],
      ["offline", 1],
      ["free", 5_000],
    ]);
    const candidates = [
      machine("held", true, "idle"),
      machine("busy", true, "busy"),
      machine("offline", false, null),
      machine("free", true, "idle"),
    ];
    expect(chooseMachine(candidates, new Set(["held"]), picked)?.id).toBe("free");
  });

  test("ties keep the candidates' order", () => {
    const candidates = [machine("a", true, "idle"), machine("b", true, "idle")];
    expect(chooseMachine(candidates, new Set())?.id).toBe("a");
    const picked = new Map([
      ["a", 2_000],
      ["b", 2_000],
    ]);
    expect(chooseMachine(candidates, new Set(), picked)?.id).toBe("a");
  });

  test("only machines with every wanted label, before the least recently picked", () => {
    const candidates = [
      machine("linux", true, "idle", machineLabels({ os: "linux", arch: "x64" })),
      machine("mac", true, "idle", machineLabels({ os: "macos", arch: "arm64" })),
      machine("mac-busy", true, "busy", machineLabels({ os: "macos", arch: "arm64" })),
    ];
    // The Linux box was never picked, so it would win without labels.
    const picked = new Map([["mac", 5_000]]);
    expect(chooseMachine(candidates, new Set(), picked)?.id).toBe("linux");
    expect(chooseMachine(candidates, new Set(), picked, ["self-hosted"])?.id).toBe("linux");
    expect(chooseMachine(candidates, new Set(), picked, ["macOS", "ARM64"])?.id).toBe("mac");
    expect(chooseMachine(candidates, new Set(), picked, ["linux", "x64"])?.id).toBe("linux");
    // A free machine without every label is never picked.
    expect(chooseMachine(candidates, new Set(), picked, ["macOS", "X64"])).toBeNull();
    expect(chooseMachine(candidates, new Set(["mac"]), picked, ["macOS"])).toBeNull();
  });
});

describe("machine labels", () => {
  test("are GitHub's self-hosted defaults from the stored os and arch", () => {
    expect(machineLabels({ os: "macos", arch: "arm64" })).toEqual([
      "self-hosted",
      "macOS",
      "ARM64",
    ]);
    expect(machineLabels({ os: "linux", arch: "x64" })).toEqual(["self-hosted", "Linux", "X64"]);
    expect(machineLabels({ os: "windows", arch: "arm" })).toEqual([
      "self-hosted",
      "Windows",
      "ARM",
    ]);
    expect(machineLabels({ os: null, arch: null })).toEqual(["self-hosted"]);
  });

  test("match when the machine has every wanted label, ignoring case", () => {
    const mac = machineLabels({ os: "macos", arch: "arm64" });
    expect(hasLabels(mac, ["self-hosted", "macOS", "ARM64"])).toBe(true);
    expect(hasLabels(mac, ["macos", "arm64"])).toBe(true);
    expect(hasLabels(mac, ["SELF-HOSTED"])).toBe(true);
    expect(hasLabels(mac, ["macOS", "X64"])).toBe(false);
    expect(hasLabels(mac, ["linux"])).toBe(false);
    expect(hasLabels(mac, ["gpu"])).toBe(false);
  });

  test("self-hosted matches every machine", () => {
    for (const os of ["linux", "macos", "windows", null])
      expect(hasLabels(machineLabels({ os, arch: "x64" }), ["self-hosted"])).toBe(true);
  });

  test("relay inputs are comma-separated, trimmed, empties dropped", () => {
    expect(parseLabels("self-hosted, macOS ,ARM64")).toEqual(["self-hosted", "macOS", "ARM64"]);
    expect(parseLabels(" macOS,, ,ARM64, ")).toEqual(["macOS", "ARM64"]);
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels("  ")).toEqual([]);
    expect(parseLabels(undefined)).toEqual([]);
  });
});

test("lastPicked keeps each machine's newest route", () => {
  const picked = lastPicked([
    { ...route, machineId: "m1", createdAt: 1_000 },
    { ...route, machineId: "m1", createdAt: 3_000 },
    { ...route, machineId: "m2", createdAt: 2_000 },
    { ...route, machineId: "m1", createdAt: 2_500 },
  ]);
  expect(picked).toEqual(
    new Map([
      ["m1", 3_000],
      ["m2", 2_000],
    ]),
  );
});

test("a route holds its machine until the job starts or the hold lapses", () => {
  expect(holdsMachine(route, 1_000)).toBe(true);
  expect(holdsMachine({ ...route, state: "dispatched" }, 1_000)).toBe(true);
  expect(holdsMachine({ ...route, state: "done" }, 1_000)).toBe(false);
  expect(holdsMachine(route, 1_000 + ROUTE_HOLD_MS)).toBe(false);
});

describe("canClaim", () => {
  const job = { jobId: 42, repositoryId: 100, runId: 9 };

  test("only a job from the route's repo and run", () => {
    expect(canClaim(route, job)).toBe(true);
    expect(canClaim(route, { ...job, repositoryId: 101 })).toBe(false);
    expect(canClaim(route, { ...job, runId: 10 })).toBe(false);
  });

  test("once claimed, only by the same job again", () => {
    const claimed = { ...route, jobId: 42, state: "dispatched" as const };
    expect(canClaim(claimed, job)).toBe(true);
    expect(canClaim(claimed, { ...job, jobId: 43 })).toBe(false);
  });
});

test("runner names start with the machine's name and stay valid", () => {
  expect(machineRunnerName("Atticus's MacBook Pro", "0123456789ab")).toBe(
    "Atticus-s-MacBook-Pro-0123456789ab",
  );
  expect(machineRunnerName("  !!  ", "0123456789ab")).toBe("machine-0123456789ab");
  expect(machineRunnerName("x".repeat(100), "0123456789ab")).toHaveLength(53);
});

describe("jobContext", () => {
  const github = (entries: [string, unknown][]) => ({
    github: { t: 2, d: entries.map(([k, v]) => ({ k, v })) },
  });

  test("reads the repo and run id from the job's github context", () => {
    expect(
      jobContext(
        github([
          ["repository", "relayrunner/relayrunner-ci-tests"],
          ["run_id", "41902043823"],
          ["event_name", "workflow_dispatch"],
        ]),
      ),
    ).toEqual({
      repo: "relayrunner/relayrunner-ci-tests",
      runId: 41902043823,
      machine: [],
      github: [],
    });
    expect(
      jobContext(
        github([
          ["repository", { s: "a/b" }],
          ["run_id", { t: 4, n: 5 }],
        ]),
      ),
    ).toEqual({ repo: "a/b", runId: 5, machine: [], github: [] });
  });

  // From a claimed relay job (relay v1.0.0-beta.2, relayrunner-ci-tests run 42078905012): the
  // `inputs` entry exactly as logged. The `github` context is cut down to what we read, because
  // the real one carries the job's token.
  const claimed = {
    github: {
      t: 2,
      d: [
        { k: "repository", v: "relayrunner/relayrunner-ci-tests" },
        { k: "run_id", v: "42078905012" },
      ],
    },
    inputs: {
      d: [
        { k: "machine", v: "self-hosted" },
        { k: "github", v: "ubuntu-latest" },
      ],
      t: 2,
    },
  };

  test("reads the relay's machine and github inputs", () => {
    expect(jobContext(claimed)).toEqual({
      repo: "relayrunner/relayrunner-ci-tests",
      runId: 42078905012,
      machine: ["self-hosted"],
      github: ["ubuntu-latest"],
    });
  });

  test("an empty machine input means no machine labels", () => {
    const inputs = {
      t: 2,
      d: [
        { k: "machine", v: "" },
        { k: "github", v: "ubuntu-latest" },
      ],
    };
    expect(jobContext({ ...claimed, inputs })?.machine).toEqual([]);
    expect(jobContext({ ...claimed, inputs: { t: 2, d: [] } })?.machine).toEqual([]);
  });

  test("returns null when either is missing", () => {
    expect(jobContext(undefined)).toBeNull();
    expect(jobContext({})).toBeNull();
    expect(jobContext(github([["repository", "a/b"]]))).toBeNull();
    expect(jobContext(github([["run_id", "5"]]))).toBeNull();
  });
});

describe("decideRoute", () => {
  const machineFirst: RunnerOrder = { steps: [{ key: "machine" }, { key: "github" }] };
  const githubFirst: RunnerOrder = { steps: [{ key: "github" }, { key: "machine" }] };
  const both = { machine: ["self-hosted"], github: ["ubuntu-latest"], private: true };
  const free = async () => "rr-0123456789ab";
  const none = async () => null;

  test("machine first: a free machine answers", async () => {
    expect(await decideRoute(machineFirst, both, free)).toEqual({
      runner: "rr-0123456789ab",
      step: "machine",
      skipped: [],
    });
  });

  test("machine first: no free machine falls to github", async () => {
    expect(await decideRoute(machineFirst, both, none)).toEqual({
      runner: "ubuntu-latest",
      step: "github",
      skipped: [{ key: "machine", reason: "no_machine" }],
    });
  });

  test("github first: github answers without looking at machines", async () => {
    const pick = vi.fn(free);
    expect(await decideRoute(githubFirst, both, pick)).toMatchObject({
      runner: "ubuntu-latest",
      step: "github",
    });
    expect(pick).not.toHaveBeenCalled();
  });

  test("a step the job didn't configure is skipped", async () => {
    expect(await decideRoute(githubFirst, { ...both, github: [] }, free)).toEqual({
      runner: "rr-0123456789ab",
      step: "machine",
      skipped: [{ key: "github", reason: "not_configured" }],
    });
  });

  test("a provider the order leaves out is never picked", async () => {
    const pick = vi.fn(free);
    const decision = await decideRoute(
      { steps: [{ key: "github" }] },
      { ...both, github: [] },
      pick,
    );
    expect(pick).not.toHaveBeenCalled();
    expect(decision).toMatchObject({ runner: null, notInOrder: ["machine"] });
    expect(decision.runner === null && decision.reason).toBe(
      "No runner available: `github` isn't set on this relay; Local machines isn't in your runner order.",
    );
  });

  test("nothing fits: fails with the reason for each provider", async () => {
    const decision = await decideRoute(
      { steps: [{ key: "machine" }] },
      { ...both, machine: ["macOS", "ARM64"] },
      none,
    );
    expect(decision).toMatchObject({
      runner: null,
      skipped: [{ key: "machine", reason: "no_machine" }],
      notInOrder: ["github"],
    });
    expect(decision.runner === null && decision.reason).toBe(
      "No runner available: no local machine with macOS, ARM64 is online and idle; GitHub-hosted isn't in your runner order.",
    );
  });

  test("a public repo never gets a machine", async () => {
    const pick = vi.fn(free);
    expect(await decideRoute(machineFirst, { ...both, private: false }, pick)).toEqual({
      runner: "ubuntu-latest",
      step: "github",
      skipped: [{ key: "machine", reason: "public_repo" }],
    });
    expect(pick).not.toHaveBeenCalled();
    const decision = await decideRoute(machineFirst, { ...both, github: [], private: false }, pick);
    expect(decision.runner === null && decision.reason).toBe(
      "No runner available: public repos never run on local machines; `github` isn't set on this relay.",
    );
  });

  test("github takes one label", async () => {
    const decision = await decideRoute(
      { steps: [{ key: "github" }] },
      { machine: [], github: ["ubuntu-latest", "macos-latest"], private: true },
      none,
    );
    expect(decision).toMatchObject({
      runner: null,
      skipped: [{ key: "github", reason: "too_many_labels" }],
    });
  });

  test("a relay with neither input fails", async () => {
    const decision = await decideRoute(
      machineFirst,
      { machine: [], github: [], private: true },
      free,
    );
    expect(decision.runner === null && decision.reason).toBe(
      "No runner available: the relay sets neither `machine` nor `github`.",
    );
  });
});
