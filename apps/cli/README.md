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
- If the machine is removed in the dashboard, `connect` deletes the saved token.
  A running `connect` exits and asks you to run it again; a new one signs in
  straight away.

Jobs run in `actions/runner`, which is downloaded into
`~/.relayrunner/runner/<version>` on first connect and checked against its
SHA-256. Set `RELAYRUNNER_HOME` to keep everything somewhere else.

## Building

`pnpm --filter relayrunner build` bundles the CLI into `dist/cli.js` with
tsdown, including the workspace's `@relayrunner/machine-protocol` package.
