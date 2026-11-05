import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default glob walks the whole repo, including agent worktrees under `.claude/`.
    include: ["{apps,packages,tests}/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    // The API tests run each request against a local D1 (wrangler's platform proxy), and a test
    // that enrolls a machine makes a dozen of them. With every file running at once on a CI
    // runner, several of those land near the 5s default ("pages with a before cursor", "revoking
    // a machine…") without anything being wrong.
    testTimeout: 15_000,
  },
});
