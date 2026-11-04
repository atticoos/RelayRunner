# RelayRunner

RelayRunner is a hosted gateway that routes GitHub Actions jobs to the runners a workspace configures.

## Workspace

Use pnpm 11.28.9 (pinned by `packageManager`; Corepack picks it up) and run
`pnpm install` from the repository root.

- `apps/` holds runnable applications.
- `packages/` holds shared libraries.

## Development checks

Use the Node.js version in `.nvmrc` (24.x). Write workspace code in
TypeScript and place Vitest tests next to the code they cover, using
`*.test.ts` or `*.test.mts`.

- `pnpm lint` runs Oxlint.
- `pnpm format` formats the repo with oxfmt; `pnpm format:check` verifies it.
- `pnpm typecheck` checks types without emitting JavaScript.
- `pnpm test` runs the test suite once.
- `pnpm test:watch` reruns affected tests as files change.

GitHub Actions runs lint, format, type, and test checks on pushes and pull
requests.

`pnpm check` runs the same checks locally. `pnpm install` sets up the Husky
pre-commit hook, which runs Oxlint and oxfmt on staged files (via lint-staged)
and then type checking before each commit. In VS Code or Cursor, install the
recommended Oxc extension to format on save.
