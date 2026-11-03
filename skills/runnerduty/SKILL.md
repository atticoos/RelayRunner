---
name: runnerduty
description: Set up RunnerDuty, switch between local and GitHub-hosted runners, and check routing for selected GitHub Actions jobs in a private repository. Discover jobs, show the workflow patch, and install and verify the developer's GitHub runner.
---

Use the RunnerDuty CLI from a trusted installed copy. If it is unavailable, use the installation instructions in the RunnerDuty repository README. Run commands with `--json` and use `--cwd` to target the developer's checkout.

1. Run `runnerduty discover --cwd <checkout> --json`. Confirm the repository and let the user select jobs using the returned IDs. A job needs to be compatible with the developer's OS and tools. Check its steps and dependencies before recommending it.
2. Run `runnerduty preview --cwd <checkout> --job <id> --json`, repeating `--job` for every selected job. Show the actual patch, target branch, and the hosted fallback. Explain that setup starts GitHub's runner under the developer's local account. Use the user's existing authorization if it covers the displayed patch and runner setup. Otherwise obtain it before proceeding. Only set up repositories whose workflow authors the user trusts.
3. Run `runnerduty setup` with the same checkout and job arguments, plus `--approve <fingerprint> --json`. Use the fingerprint from the authorized preview. For a stale preview, show the new patch before applying it. For an interrupted setup, rerun the same command if the fingerprint is still current. If the patch was applied, a fresh preview can verify that no workflow changes remain.
4. Report the returned online status, runner label, and local workflow changes. The checkout changes need to go through the usual commit and push workflow before GitHub can use them. Commit or push only within the user's authorization.

For `GITHUB_ACCESS`, report the need for authorized GitHub CLI credentials and repository administration permission. If the environment restricts existing credential access, use its approved execution mechanism. Keep authentication and runner registration inside the CLI. Setup leaves routing inactive.

After the setup changes are committed and pushed, use `runnerduty switch local` to route opted-in jobs across the repository. Use `runnerduty status` to report the current route and runner availability. Use `runnerduty switch hosted` when the user wants to restore hosted execution for future jobs, and report any queued jobs or warning returned by the command.

When asked for local runner usage or minutes saved, run `runnerduty report --cwd <checkout> --json`. The default window covers workflow runs created in the last 30 days. Use `--days` for a different window. Summarize completed local job attempts, outcomes, and runtime by workflow. Explain that the savings estimate uses measured local runtime and surface any attempts with missing timing.
