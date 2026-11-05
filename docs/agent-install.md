# Set up RelayRunner with an agent

You are a coding agent setting up RelayRunner for the user. RelayRunner runs a private repo's
GitHub Actions jobs on the user's own computer when it is online and free. Otherwise the jobs
run on GitHub-hosted runners as usual. Setup has two parts: connect this computer, then opt
jobs in with a small workflow change.

Work in the user's current checkout unless they name another. Explain each step in a sentence
before you run it. Ask before changing any file.

## 1. Check the basics

- Supported systems are macOS and Linux, on x64 or ARM64. Windows is not supported yet. Stop
  and say so if the computer runs anything else.
- Node.js 22 or newer: `node --version`.
- The checkout's GitHub repo must be **private** and owned by a **GitHub organization**.
  RelayRunner never routes public repos to a personal computer, and personal accounts aren't
  supported yet. Check with `gh repo view --json visibility,owner` if the GitHub CLI is
  available, or ask the user.

## 2. Install the CLI

```sh
npm install --global relayrunner@latest
relayrunner --help
```

If the user prefers not to install globally, use `npx relayrunner@latest` in place of
`relayrunner` in every command below.

## 3. Connect this computer

Check whether it is already connected:

```sh
relayrunner whoami --json
```

- If `status` is `"ok"`, the computer is enrolled. Tell the user which machine and workspace
  it is, and whether `machine.status.online` is true. Then go to step 4.
- Otherwise it needs to sign in.

`relayrunner connect` signs in on the first run, then stays running in the foreground. While
it runs, the computer is online and takes jobs. When it stops, jobs go back to GitHub. Ask the
user to run it **in their own terminal and leave it open**:

```sh
relayrunner connect
```

Don't run it yourself unless the user asks: it would go offline when your session ends.

The first run opens the browser to the RelayRunner dashboard. There the user signs in with
GitHub (this creates their account), creates a workspace, installs the RelayRunner GitHub App
on their organization, and approves the computer. The terminal then says the machine is
enrolled and online.

When the user says it's done, check again with `relayrunner whoami --json`. Expect `status`
`"ok"` and `machine.status.online` true. If the GitHub App install only sent a request to the
org's owners, jobs start reaching this computer once an owner accepts it.

## 4. Choose the jobs

List the workflows in `.github/workflows/` and the jobs in each. Suggest jobs that can run on
this computer, and let the user pick. A job is a good fit when:

- it runs on `ubuntu-latest` today. When the computer is offline or busy, an opted-in job runs
  on `ubuntu-latest`, whatever it used before.
- it has **no** `strategy.matrix`. Each routed job needs its own pick, so a matrix can't share
  one.
- it has no `container:` or `services:`, unless this computer is Linux with Docker running.
- its steps work on this computer's OS. On macOS, check for Linux-only commands such as
  `apt-get`, and for actions that only support Linux.
- it doesn't deploy or use production secrets. It is the user's computer, so that is their
  call, but point it out.

## 5. Show the patch, then apply it

For each chosen job, add a pick job just before it. The pick asks RelayRunner where this run
of the job should go. Then point the job's `runs-on` at the pick's answer. Name the pick
`pick-<job id>` so each routed job has its own.

Before:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

After:

```yaml
jobs:
  pick-test:
    runs-on: relayrunner
    outputs:
      runner: ${{ steps.route.outputs.runner }}
    steps:
      # Only runs if an ordinary runner takes this job. RelayRunner answers without running steps.
      - id: route
        run: echo "runner=ubuntu-latest" >> "$GITHUB_OUTPUT"

  test:
    needs: pick-test
    if: ${{ !cancelled() }}
    runs-on: ${{ needs.pick-test.outputs.runner || 'ubuntu-latest' }}
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

Keep everything else in the job as it is. Watch out for these cases:

- **The job already has `needs:`.** Add the pick to the list (`needs: [build, pick-test]`).
  Keep the job from running after one of its original dependencies fails by requiring each one
  to succeed:
  `if: ${{ !cancelled() && needs.build.result == 'success' }}`. Don't require the pick to
  succeed: if it fails, the job falls back to `ubuntu-latest`.
- **The job already has `if:`.** Combine it: `if: ${{ !cancelled() && (<existing condition>) }}`.
- **Other jobs depend on this one.** Leave them alone. They still depend on `test`.

Show the user the full diff and wait for their approval before you write it. Then tell them
to commit and push it. It takes effect on the next run, and the checks keep their names in
GitHub.

## 6. Confirm it works

After the user pushes, a run of an opted-in job shows `pick-<job>` finishing in about a second,
then the job itself. In the job's log, the runner name tells where it ran: a name starting
with this computer's machine name (from `relayrunner whoami`) means it ran here, and a
GitHub-hosted name means the fallback. If the job stays
queued on `relayrunner`, the GitHub App is probably not installed on the repo's organization.
The user can check under Settings → GitHub orgs in the dashboard.

To stop using this computer for a while, the user presses Ctrl-C in the `relayrunner connect`
terminal. Jobs go back to GitHub-hosted runners, with no workflow change.
