import { describe, expect, test } from "vitest";
import {
  canClaim,
  chooseMachine,
  holdsMachine,
  jobContext,
  machineRunnerName,
  newRouteId,
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
  const machine = (id: string, online: boolean, state: "idle" | "busy" | null) => ({
    id,
    name: id,
    online,
    state,
  });

  test("picks the first online, idle machine no route holds", () => {
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
    expect(chooseMachine([], new Set())).toBeNull();
  });
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
    ).toEqual({ repo: "relayrunner/relayrunner-ci-tests", runId: 41902043823 });
    expect(
      jobContext(
        github([
          ["repository", { s: "a/b" }],
          ["run_id", { t: 4, n: 5 }],
        ]),
      ),
    ).toEqual({ repo: "a/b", runId: 5 });
  });

  test("returns null when either is missing", () => {
    expect(jobContext(undefined)).toBeNull();
    expect(jobContext({})).toBeNull();
    expect(jobContext(github([["repository", "a/b"]]))).toBeNull();
    expect(jobContext(github([["run_id", "5"]]))).toBeNull();
  });
});
