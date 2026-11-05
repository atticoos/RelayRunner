import { describe, expect, test } from "vitest";
import { DEFAULT_RUNNER_ORDER, readRunnerOrder, runnerOrderSchema } from "./index.ts";

describe("runnerOrderSchema", () => {
  test("accepts either order of the two providers, or one alone", () => {
    for (const steps of [
      [{ key: "machine" }, { key: "github" }],
      [{ key: "github" }, { key: "machine" }],
      [{ key: "github" }],
      [{ key: "machine" }],
    ]) {
      expect(runnerOrderSchema.safeParse({ steps }).success).toBe(true);
    }
  });

  test("rejects an empty order", () => {
    const result = runnerOrderSchema.safeParse({ steps: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Add at least one provider.");
  });

  test("rejects a provider listed twice", () => {
    const result = runnerOrderSchema.safeParse({
      steps: [{ key: "machine" }, { key: "github" }, { key: "machine" }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["steps", 2, "key"],
      message: "Local machines is already in the order.",
    });
  });

  test("rejects unknown keys and labels on steps", () => {
    expect(runnerOrderSchema.safeParse({ steps: [{ key: "blacksmith" }] }).success).toBe(false);
    const labelled = runnerOrderSchema.parse({ steps: [{ key: "github", label: "macos" }] });
    expect(labelled).toEqual({ steps: [{ key: "github" }] });
  });
});

describe("readRunnerOrder", () => {
  test("a workspace without an order gets machine then github", () => {
    expect(readRunnerOrder(null)).toEqual(DEFAULT_RUNNER_ORDER);
    expect(DEFAULT_RUNNER_ORDER.steps.map((step) => step.key)).toEqual(["machine", "github"]);
  });

  test("a stored order reads back", () => {
    expect(readRunnerOrder('{"steps":[{"key":"github"}]}')).toEqual({ steps: [{ key: "github" }] });
  });

  test("an unreadable value falls back to the default", () => {
    expect(readRunnerOrder("not json")).toEqual(DEFAULT_RUNNER_ORDER);
    expect(readRunnerOrder('{"steps":[]}')).toEqual(DEFAULT_RUNNER_ORDER);
  });
});
