# RelayRunner

RelayRunner helps developers switch GitHub Actions jobs between GitHub-hosted runners and their local machines. Run jobs locally during active development to save GitHub Actions minutes, then switch back to GitHub-hosted runners when you're done.

## Install the CLI and skill

After the first npm release, install the CLI and verify it:

```sh
npm install --global relayrunner
relayrunner --help
```

Node.js 22+, Git, and an authorized GitHub CLI are required. Repository setup
supports macOS and Linux on x64 or ARM64 and requires curl, tar, and the official
runner's OS dependencies. Run as the developer account.

### Install with an agent

Paste this into your agent from the checkout you want to set up:

```text
Set up RelayRunner in this checkout using https://raw.githubusercontent.com/atticoos/RelayRunner/main/docs/agent-install.md
```

### Install the optional agent skill

The same bundled skill works with Codex, Claude Code, and Cursor on your
local machine. Choose your agent's personal skill directory:

| Agent | Directory |
| --- | --- |
| Codex | `${CODEX_HOME:-$HOME/.codex}/skills/relayrunner` |
| Claude Code | `$HOME/.claude/skills/relayrunner` |
| Cursor | `$HOME/.cursor/skills/relayrunner` |

With the CLI installed, copy the bundled skill. The example uses the Codex
directory. Replace it with the directory for your agent.

```sh
relayrunner_skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/relayrunner"
mkdir -p "$relayrunner_skill_dir"
cp -i "$(npm root --global)/relayrunner/dist/SKILL.md" "$relayrunner_skill_dir/SKILL.md"
```

If the destination already has a skill, compare it before replacing it.
In a new local session, ask your agent to use the RelayRunner skill in the
checkout you want to set up.

## Set up a repository

If RelayRunner is installed, paste this into your agent from the target checkout:

```text
Use the RelayRunner skill to set up this repository. Show me the eligible jobs, let me choose which ones to opt in, and show me the workflow patch for approval before applying it.
```

For manual setup, run the following commands.

Run from the target checkout or pass `--cwd /path/to/checkout`.

```sh
relayrunner discover
relayrunner preview --job .github/workflows/ci.yml:test
relayrunner setup --job .github/workflows/ci.yml:test --approve <fingerprint>
```

Repeat `--job` to select multiple jobs. Review the patch before passing the
fingerprint. Discovery supports jobs in tracked workflows with a literal, recognized
GitHub-hosted runner label. Check that the selected jobs
can run on your machine. Setup targets a private, non-fork repository on
github.com through its `origin` remote. Trust everyone who can author
workflows for that repository. Jobs assigned to the runner execute as your
local user.

RelayRunner uses the existing GitHub CLI session. It needs access to the
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
`~/.relayrunner/<repository-id>` (override the base with `RELAYRUNNER_HOME`).
Rerun setup to resume after a transient failure or restart an offline runner.
If setup was interrupted after applying the patch, preview again for a current
fingerprint. A hard interruption can leave a `setup.lock` symlink. Check
the PID in its target and remove the symlink only after that process has exited.

Add `--json` for one JSON result on stdout. Errors have `ok: false` and an
`error` object with `code` and `message`, and exit nonzero.

## Switch runners

After committing and pushing the setup changes, run these commands in the checkout.

- `relayrunner switch local` routes opted-in jobs across the repository to this machine after GitHub confirms the runner is online.
- `relayrunner status` shows the repository route and runner availability.
- `relayrunner switch hosted` restores hosted routing for future jobs and reports jobs still queued for the local runner.

The switch applies across branches and workflow triggers, including pull requests that GitHub allows to run. To upgrade existing branch-scoped jobs, preview and apply setup again, then commit and push the patch.

All three commands support `--cwd PATH` and `--json`. Switching uses the repository Actions variable `RELAYRUNNER_LABEL` without editing workflows. Reserve that variable at the repository and organization levels. Use one machine to manage the route.

Runner cleanup, restart-on-login, and queued-job recovery remain manual.

## Workspace

Use pnpm 10.13.1 and run `pnpm install` from the repository root.

- `apps/` holds runnable applications.
- `packages/` holds shared libraries.

Run the CLI from the repository root with `pnpm relayrunner --help`. Pass
commands and flags directly, for example `pnpm relayrunner discover --json`.

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


## Publish an npm release

Run `pnpm install --frozen-lockfile` and `pnpm check` from the repository root.
Set the release version in `apps/cli/package.json`, merge the release commit,
and tag it `v<version>`.

For the first publish, a maintainer can sign in to npm and publish the verified
tarball from the tagged checkout:

```sh
pnpm --dir apps/cli pack
bash scripts/smoke-npm-package.sh apps/cli/relayrunner-<version>.tgz
npm publish apps/cli/relayrunner-<version>.tgz --access public
```

In npm package settings, configure a GitHub Actions trusted publisher for
`atticoos/RelayRunner` with workflow filename `publish-npm.yml` and permission
to publish. For subsequent releases, run **Publish to npm** from the repository's
Actions tab and select the matching version tag. The workflow verifies and
publishes the same tarball using npm's OIDC authentication. If publishing fails
before the version appears in npm, rerun the workflow for the same tag.
See [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).
