# RelayRunner CLI

The RelayRunner CLI is being rebuilt to connect machines to the RelayRunner
gateway. See [#61](https://github.com/relayrunner/relayrunner/issues/61) for
the plan. `relayrunner connect` (#62) isn't here yet.

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
