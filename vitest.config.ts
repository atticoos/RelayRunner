import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest's default glob walks the whole repo, including agent worktrees under `.claude/`.
    include: ["{apps,packages,tests}/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
