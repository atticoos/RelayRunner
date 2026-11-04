# RelayRunner CLI

Connects a machine to the RelayRunner gateway so it can run your workspace's
GitHub Actions jobs. See [#61](https://github.com/relayrunner/relayrunner/issues/61)
for the plan.

## `relayrunner connect`

```sh
npx relayrunner connect
```

The first run signs you in: it shows a code and opens the dashboard, where you
pick the workspace and name for this machine and approve. The machine token is
saved to `~/.relayrunner/machine.json` (mode 0600); later runs reuse it.

While it runs, the machine is online: it keeps a WebSocket open to the gateway,
runs the jobs it's sent (one at a time) and prints what happens. It reconnects
on its own if the connection drops. Ctrl-C takes it offline; a job that's
running stops with it.

- `--server <url>` or `RELAYRUNNER_URL` points it at another gateway. Changing it signs in again.
- `--name <name>` changes the suggested machine name (default: the hostname).
- If the machine is removed in the dashboard, `connect` deletes the saved token
  and asks you to run it again to sign in.

Jobs run in `actions/runner`, which is downloaded into
`~/.relayrunner/runner/<version>` on first connect and checked against its
SHA-256. Set `RELAYRUNNER_HOME` to keep everything somewhere else.

## Building

`pnpm --filter relayrunner build` bundles the CLI into `dist/cli.js` with
tsdown, including the workspace's `@relayrunner/machine-protocol` package.

## Running one job by hand

Until the gateway routes jobs to machines, you can hand a machine one job
yourself:

1. In the dashboard (signed in as a workspace owner, with the org connected),
   mint a JIT runner config for the `rr-test` label from the browser console:

   ```js
   const r = await fetch("/api/debug/jit-config", {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ org: "relayrunner" }),
   });
   copy((await r.json()).jitConfig);
   ```

2. Run it on the machine (macOS or Linux, x64 or arm64, not as root):

   ```sh
   pbpaste | pnpm relayrunner debug run-job --jitconfig -
   ```

   The first run downloads `actions/runner` into `~/.relayrunner/runner/<version>`
   and checks its SHA-256. Set `RELAYRUNNER_HOME` to use another directory.

3. Dispatch a workflow with `runs-on: rr-test`, such as _RelayRunner machine
   test_ in `relayrunner/relayrunner-ci-tests`. The runner takes that one job,
   streams its output, and exits. Its `_work` directory and JIT credentials are
   deleted afterwards.

A config is good for one job. If no job arrives, stop the runner with Ctrl-C;
the unused runner stays registered in the org until you remove it.
