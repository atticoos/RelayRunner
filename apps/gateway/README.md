# RelayRunner gateway proof of concept

This app tests one idea: a Cloudflare Durable Object can act as a GitHub Actions runner for a small `pick` job, so RelayRunner can choose where the next job runs without a machine. It is not production code, and nothing in the CLI uses it.

## How it works

GitHub assigns jobs by label and never connects to a runner. A job's label can't change after it's queued, so the route has to exist first.

1. A workflow queues `pick` on the gateway's label.
2. GitHub sends a `workflow_job` webhook to the Worker.
3. The Worker wakes a `PickRunner` Durable Object with a one-job runner config.
4. The Durable Object signs in, long-polls GitHub, and claims a job.
5. It reports the route as the job's output without running any steps.
6. GitHub queues the real job on that label.

```yaml
jobs:
  pick:
    runs-on: relayrunner
    steps:
      - run: 'true' # never runs

  test:
    needs: pick
    if: ${{ !cancelled() }}
    runs-on: ${{ fromJSON(needs.pick.outputs.runner || '"ubuntu-latest"') }}
    steps:
      - run: pnpm test
```

The `if` line and the default label matter. If `pick` fails, `test` would otherwise be skipped, and a skipped required check may not block a merge.

## Try it

Use a throwaway private repository. Deploy from this directory:

```sh
pnpm exec wrangler deploy --var GITHUB_REPOSITORY:owner/repo --var RUNNER_LABEL:relayrunner
pnpm exec wrangler secret put WEBHOOK_SECRET
pnpm exec wrangler secret put ADMIN_TOKEN
```

Add a repository webhook for `workflow_job` events that points to `/webhook` and uses `WEBHOOK_SECRET`.

This proof of concept doesn't mint runner configs. Before each run, create one with GitHub's [`generate-jitconfig` API](https://docs.github.com/en/rest/actions/self-hosted-runners), using the same label, and post it. Each config serves one job.

```sh
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" --data-binary "$ENCODED_JIT_CONFIG" "$GATEWAY_URL/admin/runner-configs"
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" -d '{"runner":"ubuntu-24.04"}' "$GATEWAY_URL/admin/route"
curl -H "authorization: Bearer $ADMIN_TOKEN" "$GATEWAY_URL/admin/report"
```

## What we tested

We ran this against github.com on a private repository in November 2026.

- GitHub accepts a job with no logs or step status.
- Reported outputs reach `needs` and `runs-on`, even with no `outputs:` block on the job.
- The same workflow ran on a self-hosted runner and on GitHub-hosted runners with no edits.
- The route took 2.3 to 4.7 seconds from queue to report, across 6 runs.
- A Durable Object held a session for 85 seconds before receiving a job.

## Known limits

- **Runner version.** GitHub rejected `0.1.0`, `2.329.0` and `2.335.0` with `RunnerVersionTooOld`, and accepted a 28-day-old release. To receive jobs, this client reports the latest official runner version, even though it isn't the official runner. This is the biggest risk.
- **Private protocol.** The runner protocol has no public spec, and GitHub can change it without notice.
- **Outages stall CI.** If nothing answers `pick`, it stays queued and the real job waits behind it.
- **Any matching job.** A runner gets any pending job with its label, which may not be the one from its webhook. Route from the claimed job, not the webhook.
- **No visible trail.** `pick` shows no steps or logs, so a reader can't see why a route was chosen.
- **Leftover runners.** A runner that never gets a job stays registered as offline until it's deleted.

## Not tested

- Minting runner configs from a GitHub App.
- Third-party providers such as Blacksmith.
- Simultaneous load, jobs long enough to need lock renewal, and job cancellation.
- Whether GitHub's Acceptable Use Policies allow a custom runner client.
