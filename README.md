# RunnerDuty

RunnerDuty helps developers switch GitHub Actions jobs between GitHub-hosted runners and their local machines. Run jobs locally during active development to save GitHub Actions minutes, then switch back to GitHub-hosted runners when you're done.

## Install the CLI and skill

After the first npm release, install the CLI and verify it:

```sh
npm install --global runnerduty
runnerduty --help
```

Node.js 22+, Git, and an authorized GitHub CLI are required. Repository setup
supports macOS and Linux on x64 or ARM64 and requires curl, tar, and the official
runner's OS dependencies. Run as the developer account.

### Install with an agent

Paste this into your agent from the checkout you want to set up:

```text
Set up RunnerDuty in this checkout using https://raw.githubusercontent.com/atticoos/RunnerDuty/main/docs/agent-install.md
```

### Install the optional agent skill

The same bundled skill works with Codex, Claude Code, and Cursor on your
local machine. Choose your agent's personal skill directory:

| Agent | Directory |
| --- | --- |
| Codex | `${CODEX_HOME:-$HOME/.codex}/skills/runnerduty` |
| Claude Code | `$HOME/.claude/skills/runnerduty` |
| Cursor | `$HOME/.cursor/skills/runnerduty` |

With the CLI installed, copy the bundled skill. The example uses the Codex
directory. Replace it with the directory for your agent.

```sh
runnerduty_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/runnerduty"
mkdir -p "$runnerduty_skill_dir"
cp -i "$(npm root --global)/runnerduty/dist/SKILL.md" "$runnerduty_skill_dir/SKILL.md"
```

If the destination already has a skill, compare it before replacing it.
In a new local session, ask your agent to use the RunnerDuty skill in the
checkout you want to set up.

## Set up a repository

If RunnerDuty is installed, paste this into your agent from the target checkout:

```text
Use the RunnerDuty skill to set up this repository. Show me the eligible jobs, let me choose which ones to opt in, and show me the workflow patch for approval before applying it.
```

For manual setup, run the following commands.

Run from the target checkout or pass `--cwd /path/to/checkout`.

```sh
runnerduty discover
runnerduty preview --job .github/workflows/ci.yml:test
runnerduty setup --job .github/workflows/ci.yml:test --approve <fingerprint>
```

Repeat `--job` to select multiple jobs. Review the patch before passing the
fingerprint. Discovery supports jobs in tracked workflows with a literal, recognized
GitHub-hosted runner label. Check that the selected jobs
can run on your machine. Setup targets a private, non-fork repository on
github.com through its `origin` remote. Trust everyone who can author
workflows for that repository. Jobs assigned to the runner execute as your
local user.

RunnerDuty uses the existing GitHub CLI session. It needs access to the
private repository, read access to Actions variables, and repository
administration access to register the runner. Organization policy must permit
repository runners. A sandbox may require permission to access the existing
credential store and GitHub. Registration tokens pass directly to the official
runner and are excluded from CLI output and command arguments.
See [GitHub's runner API permissions](https://docs.github.com/en/rest/actions/self-hosted-runners)
and [self-hosted runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Setup downloads and verifies GitHub's official runner, registers a unique
name and label, and starts a detached listener. After GitHub reports it online,
setup applies the reviewed patch to the working tree. Commit and push through
your usual Git workflow. The runner keeps its configuration in
`~/.runnerduty/<repository-id>` (override the base with `RUNNERDUTY_HOME`).
Rerun setup to resume after a transient failure or restart an offline runner.
If setup was interrupted after applying the patch, preview again for a current
fingerprint. A hard interruption can leave a `setup.lock` symlink. Check
the PID in its target and remove the symlink only after that process has exited.

Add `--json` for one JSON result on stdout. Errors have `ok: false` and an
`error` object with `code` and `message`, and exit nonzero.

## Switch runners

After committing and pushing the setup changes, run these commands in the checkout.

- `runnerduty switch local` routes opted-in jobs across the repository to this machine after GitHub confirms the runner is online.
- `runnerduty status` shows the repository route and runner availability.
- `runnerduty switch hosted` restores hosted routing for future jobs and reports jobs still queued for the local runner.

The switch applies across branches and workflow triggers, including pull requests that GitHub allows to run. To upgrade existing branch-scoped jobs, preview and apply setup again, then commit and push the patch.

All three commands support `--cwd PATH` and `--json`. Switching uses the repository Actions variable `RUNNERDUTY_LABEL` without editing workflows. Reserve that variable at the repository and organization levels. Use one machine to manage the route.

Runner cleanup, restart-on-login, and queued-job recovery remain manual.

## Workspace

Use pnpm 10.13.1 and run `pnpm install` from the repository root.

- `apps/` holds runnable applications.
- `packages/` holds shared libraries.

Run the CLI from the repository root with `pnpm runnerduty --help`. Pass
commands and flags directly, for example `pnpm runnerduty discover --json`.

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


## Prepare an npm release

From the repository root, install dependencies with
`pnpm install --frozen-lockfile` and run `pnpm check`. Set the release version
in `apps/cli/package.json`, then pack the release:

```sh
cd apps/cli
pnpm pack
```

Install the generated tarball into a temporary npm prefix and run its
`runnerduty --help`. Verify that the installed `dist/SKILL.md` matches
`skills/runnerduty/SKILL.md` in the source tree. With npm publish access,
publish the verified tarball using `npm publish ./runnerduty-<version>.tgz`.
