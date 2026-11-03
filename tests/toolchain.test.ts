import { expect, test } from "vitest";

test("the test runner executes TypeScript", () => {
  const result: string = typeof test;
  expect(result).toBe("function");
});
