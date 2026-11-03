# RunnerDuty

Run selected GitHub Actions jobs on your own machine during development, then
switch future jobs back to GitHub-hosted runners.

## Install

```sh
npm install --global runnerduty
runnerduty --help
```

RunnerDuty requires Node.js 22+, Git, and an authenticated GitHub CLI. Runner
setup supports macOS and Linux on x64 and ARM64.

## Set up a repository

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
