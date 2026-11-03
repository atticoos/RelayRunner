# RunnerDuty

RunnerDuty helps developers switch GitHub Actions jobs between GitHub-hosted runners and their local machines. Run jobs locally during active development to save GitHub Actions minutes, then switch back to GitHub-hosted runners when you're done.

## Workspace

Use pnpm 10.13.1 and run `pnpm install` from the repository root.

- `apps/` holds runnable applications.
- `packages/` holds shared libraries.

Run the CLI from the repository root with `pnpm runnerduty --help`. Pass
commands and flags directly, for example `pnpm runnerduty discover --json`.

## Install the CLI and skill

From a trusted RunnerDuty checkout, run `pnpm install --frozen-lockfile` and
`npm install --global ./apps/cli`. This installs the `runnerduty` executable
from the checkout. Node.js 22+, Git and an authorized GitHub CLI are required.
Setup supports macOS and Linux on x64 or ARM64 and requires curl, tar, and the
official runner's OS dependencies. Run as the developer account.

An agent can install the skill on the user's behalf by copying
`skills/runnerduty/SKILL.md` from the trusted RunnerDuty checkout into the
agent's personal skill directory. For Codex, run these commands from that
checkout with permission to write to the user's skill directory:

```sh
runnerduty_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/runnerduty"
mkdir -p "$runnerduty_skill_dir"
cp -i skills/runnerduty/SKILL.md "$runnerduty_skill_dir/SKILL.md"
runnerduty --help
```

If the destination already has a skill, compare it before replacing it.
In a new Codex chat, invoke `$runnerduty` and identify the checkout to set up.

## Set up a repository

Run from the target checkout or pass `--cwd /path/to/checkout`.

```sh
runnerduty discover
runnerduty preview --job .github/workflows/ci.yml:test
runnerduty setup --job .github/workflows/ci.yml:test --approve <fingerprint>
```

Repeat `--job` to select multiple jobs. Review the patch before passing the
fingerprint. Discovery supports tracked workflows triggered by `push` with
a literal, recognized GitHub-hosted runner label. Check that the selected jobs
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

- `runnerduty switch local` routes opted-in push jobs on the current branch to this machine after GitHub confirms the runner is online. If another branch is already routed locally, switch to hosted before switching the new branch to local.
- `runnerduty status` shows the repository route, the branch it applies to, and runner availability.
- `runnerduty switch hosted` restores the original hosted runner for future jobs. Running jobs can finish, and the command lists jobs GitHub still reports as queued for the local runner.

All three commands support `--cwd PATH` and `--json`. Switching changes repository Actions variables without editing workflows. Reserve `RUNNERDUTY_REF` and `RUNNERDUTY_LABEL` at the repository and organization levels. Use one machine to manage the route. GitHub compares refs case-insensitively, so avoid branch names that differ only by case.

Runner cleanup, restart-on-login, and queued-job recovery remain manual.

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
