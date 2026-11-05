import { describe, expect, test } from "vitest";
import { failureText, jobNames, walkLines, walkSummary, type RouteWalk } from "./route-walk.ts";

const walk = (rest: Partial<RouteWalk>): RouteWalk => ({
  step: "github",
  skipped: [],
  notInOrder: [],
  machine: ["self-hosted"],
  github: ["ubuntu-latest"],
  ...rest,
});

describe("walkSummary", () => {
  test("says nothing when the first step took the job", () => {
    expect(walkSummary(walk({ step: "machine" }))).toBeNull();
    // Leaving a provider out of the relay isn't news.
    expect(
      walkSummary(walk({ skipped: [{ key: "machine", reason: "not_configured" }], machine: [] })),
    ).toBeNull();
  });

  test("names what blocked a machine", () => {
    expect(
      walkSummary(
        walk({ skipped: [{ key: "machine", reason: "no_machine" }], machine: ["macOS", "ARM64"] }),
      ),
    ).toEqual({ text: "no idle machine with macOS, ARM64", tone: "fallback" });
    expect(walkSummary(walk({ skipped: [{ key: "machine", reason: "no_machine" }] }))).toEqual({
      text: "no idle machine",
      tone: "fallback",
    });
    expect(walkSummary(walk({ skipped: [{ key: "machine", reason: "public_repo" }] }))).toEqual({
      text: "public repo",
      tone: "info",
    });
  });

  test("names the paused machines", () => {
    const paused = (names: string[]) =>
      walk({
        skipped: [{ key: "machine", reason: "machine_paused", paused: names }],
        machine: ["macOS", "ARM64"],
      });
    expect(walkSummary(paused(["atticus-mbp"]))).toEqual({
      text: "atticus-mbp is paused",
      tone: "fallback",
    });
    expect(walkSummary(paused(["a", "b"]))?.text).toBe("a and b are paused");
    expect(walkSummary(paused(["a", "b", "c"]))?.text).toBe("3 machines are paused");
    expect(walkLines(paused(["atticus-mbp"]), "ubuntu-latest")[0]?.text).toBe(
      "the only machine with macOS, ARM64, atticus-mbp, is paused",
    );
    expect(walkLines(paused(["a", "b"]), "ubuntu-latest")[0]?.text).toBe(
      "every machine with macOS, ARM64 is paused (a, b)",
    );
  });

  test("never hides a provider the order leaves out", () => {
    expect(walkSummary(walk({ step: "machine", notInOrder: ["github"] }))).toEqual({
      text: "github is set but not in your order",
      tone: "info",
    });
  });
});

test("walkLines walks the order, then the providers outside it", () => {
  expect(
    walkLines(
      walk({
        step: "machine",
        skipped: [{ key: "github", reason: "not_configured" }],
        notInOrder: [],
        github: [],
      }),
      "studio",
    ),
  ).toEqual([
    { position: 1, key: "github", state: "skipped", text: "the relay doesn't set github" },
    { position: 2, key: "machine", state: "ran", text: "on studio" },
  ]);
  expect(
    walkLines(
      walk({
        step: null,
        skipped: [{ key: "machine", reason: "no_machine" }],
        notInOrder: ["github"],
        machine: ["Windows"],
      }),
      null,
    ),
  ).toEqual([
    {
      position: 1,
      key: "machine",
      state: "skipped",
      text: "no machine with Windows was online and idle",
    },
    { position: null, key: "github", state: "not_tried", text: "not in your runner order" },
  ]);
});

test("failureText drops the prefix GitHub shows", () => {
  expect(
    failureText(
      "No runner available: public repos never run on local machines; `github` isn't set on this relay.",
    ),
  ).toBe("public repos never run on local machines; github isn't set on this relay");
});

describe("jobNames", () => {
  test("reads as a phrase", () => {
    expect(jobNames([])).toBeNull();
    expect(jobNames(["build"])).toBe("build");
    expect(jobNames(["build", "test"])).toBe("build and test");
    expect(jobNames(["build", "test", "deploy"])).toBe("build, test and deploy");
    expect(jobNames(["a", "b", "c", "d", "e"])).toBe("a, b and 3 more");
  });
});
