# RunnerDuty

RunnerDuty helps developers switch GitHub Actions jobs between GitHub-hosted runners and their local machines. Run jobs locally during active development to save GitHub Actions minutes, then switch back to GitHub-hosted runners when you're done.

## Workspace

Use pnpm 10.13.1 and run `pnpm install` from the repository root.

- `apps/` holds runnable applications.
- `packages/` holds shared libraries.

## Development checks

Use Node.js 22.18 or later in the 22.x release line. Write workspace code in
TypeScript and place Vitest tests next to the code they cover, using
`*.test.ts` or `*.test.mts`.

- `pnpm lint` runs Oxlint.
- `pnpm typecheck` checks types without emitting JavaScript.
- `pnpm test` runs the test suite once.
- `pnpm test:watch` reruns affected tests as files change.

GitHub Actions runs all three checks on pushes and pull requests.

`pnpm check` runs all three checks locally. `pnpm install` sets up the Husky
pre-commit hook, which runs lint and type checking before each commit.
