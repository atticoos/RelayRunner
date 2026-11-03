import assert from "node:assert/strict";
import { test } from "node:test";

test("the test runner executes TypeScript", () => {
  const result: string = typeof test;
  assert.equal(result, "function");
});
