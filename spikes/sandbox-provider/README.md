# Sandbox provider spike

Throwaway Worker for step 1 of the Cloudflare Sandbox spike: does the GitHub Actions runner work
in a Cloudflare Container, which steps break, how fast it starts, and what a job minute costs.
Not part of the product; delete it once the spike is written up.

## How it works

1. `.github/workflows/sandbox-spike.yml` in relayrunner/relayrunner-ci-tests calls `POST /launch`
   with its GitHub OIDC token (audience `relayrunner-sandbox-spike`). Only that repository's runs
   are accepted.
2. For each job the Worker mints an org JIT runner on `rr-sb-<run id>-<job>` with the RelayRunner
   App and starts a `SandboxRunner` Durable Object's container, which runs
   `run.sh --jitconfig` once and exits.
3. The workflow's jobs run on those labels. Its last job calls `POST /cleanup`, which destroys any
   container still up, deletes runners that never got a job, and reports each container's
   lifetime. A container is destroyed after 30 minutes regardless.

Images: `images/runner` (Ubuntu 24.04 + runner, as `runner` with sudo) and `images/dind` (the same
plus Docker, started with iptables off, then rootless if that fails).

Sizes, chosen per launch: `4x12` (4 vCPU, 12 GiB, 20 GB, the default), `2x8`, `standard-2`.

## Deploy

Needs Docker running locally (wrangler builds and pushes the images):

```sh
pnpm install
pnpm --filter @relayrunner/sandbox-spike run deploy
```

It uses the App key from the account's Secrets Store, like apps/api.
