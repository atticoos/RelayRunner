#!/usr/bin/env node
// The CLI is being rebuilt around the gateway (see #61). `relayrunner connect` (#62) lands next;
// until then the only command is the hidden `debug run-job`.
import { readFileSync } from "node:fs";
import { defineCommand, runMain } from "citty";
import { ensureRunner, RunnerError } from "./install.ts";
import { runJob } from "./job.ts";

const runJobCommand = defineCommand({
  meta: {
    name: "run-job",
    description:
      "Run one job from a JIT runner config, the way a gateway `run` message would. Pass - to read the config from stdin.",
  },
  args: {
    jitconfig: {
      type: "string",
      description: "GitHub's encoded_jit_config, or - for stdin",
      required: true,
    },
  },
  async run({ args }) {
    const jitConfig = (args.jitconfig === "-" ? readFileSync(0, "utf8") : args.jitconfig).trim();
    if (!jitConfig) throw new RunnerError("USAGE", "The JIT config is empty.");
    const log = (line: string) => console.error(`relayrunner: ${line}`);
    const runner = await ensureRunner({ log });
    const result = await runJob(
      { v: 1, type: "run", routeId: "debug", jitConfig },
      {
        runner,
        report: (update) =>
          log(`job ${update.state}${update.message ? `: ${update.message}` : ""}`),
      },
    );
    if (result.state === "failed") process.exitCode = 1;
  },
});

const debug = defineCommand({
  meta: { name: "debug", description: "Commands for testing RelayRunner by hand", hidden: true },
  subCommands: { "run-job": runJobCommand },
});

const main = defineCommand({
  meta: {
    name: "relayrunner",
    description: "Run GitHub Actions jobs on your machine through the RelayRunner gateway.",
  },
  subCommands: { debug },
});

runMain(main).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
