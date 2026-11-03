# RunnerDuty

Run selected GitHub Actions jobs on your own machine during development, then
switch future jobs back to GitHub-hosted runners.

## Install

### Install with an agent

Paste this into your agent from the checkout you want to set up:

```text
Set up RunnerDuty in this checkout using https://raw.githubusercontent.com/atticoos/RunnerDuty/main/docs/agent-install.md
```

### Install manually

```sh
npm install --global runnerduty
runnerduty --help
```

RunnerDuty requires Node.js 22+, Git, and an authenticated GitHub CLI. Runner
setup supports macOS and Linux on x64 and ARM64.

## Set up a repository

If RunnerDuty is installed, paste this into your agent from the target checkout:

```text
Use the RunnerDuty skill to set up this repository. Show me the eligible jobs, let me choose which ones to opt in, and show me the workflow patch for approval before applying it.
```

From a private GitHub repository checkout, discover eligible jobs and preview
the workflow change for the job you want to opt in:

```sh
runnerduty discover
runnerduty preview --job .github/workflows/ci.yml:test
```

Use the job ID from discovery. Review the patch before approving setup with
the preview's fingerprint. Setup registers a runner that executes jobs under
your local account.

The package includes the RunnerDuty skill for Codex, Claude Code, and Cursor.
See the [project README](https://github.com/atticoos/RunnerDuty#readme) for
skill installation, repository setup, and switching runners.

## Local runner usage

Run `runnerduty report` for the last 30 days, or pass `--days 7` for a shorter
window. Add `--json` for structured output. The report counts completed job
attempts, including reruns, on this machine’s RunnerDuty runner. It groups
counts and runtime by workflow using GitHub’s available history for runs
created in the window.

Estimated hosted minutes saved use measured local job runtime as a proxy.
Hosted runtimes and billed minutes can differ.
