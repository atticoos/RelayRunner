#!/usr/bin/env node
import { hostname } from "node:os";
import * as clack from "@clack/prompts";
import { defineCommand, runMain } from "citty";
import { connect, type ConnectionEvent } from "./connection.ts";
import {
  credentialsPath,
  deleteCredentials,
  readCredentials,
  writeCredentials,
  type Credentials,
} from "./credentials.ts";
import { ensureRunner, RunnerError, runnerPlatform } from "./install.ts";
import { runJob } from "./job.ts";
import { login, LoginError, openBrowser } from "./login.ts";

// The dashboard's origin. It forwards /api/* (including the machine WebSocket) to the API.
const DEFAULT_SERVER = "https://relayrunner-app.relayrun.workers.dev";

const connectCommand = defineCommand({
  meta: {
    name: "connect",
    description:
      "Put this machine online for your workspace and run the jobs the gateway sends it. Signs in on first run; Ctrl-C takes the machine offline.",
  },
  args: {
    server: {
      type: "string",
      description: `RelayRunner URL (default: $RELAYRUNNER_URL or ${DEFAULT_SERVER})`,
    },
    name: {
      type: "string",
      description: "Suggested machine name when signing in (default: this computer's hostname)",
    },
  },
  async run({ args }) {
    try {
      await connectMachine(args);
    } catch (error) {
      if (!(error instanceof LoginError || error instanceof RunnerError)) throw error;
      clack.log.error(error.message);
      process.exitCode = 1;
    }
  },
});

async function connectMachine(args: { server?: string; name?: string }) {
  // An explicit --server or RELAYRUNNER_URL wins; otherwise keep the gateway this machine
  // enrolled with.
  const requested = args.server || process.env.RELAYRUNNER_URL;
  const target = runnerPlatform();
  const platform = { os: target.os === "osx" ? "macos" : "linux", arch: target.arch } as const;

  clack.intro("RelayRunner");

  let credentials = readCredentials();
  const server = normalizeServer(requested || credentials?.server || DEFAULT_SERVER);
  if (credentials && credentials.server !== server) {
    clack.log.warn(
      `This machine is enrolled with ${credentials.server}, not ${server}. Signing in again.`,
    );
    credentials = null;
  }
  if (!credentials) {
    credentials = await signIn(server, args.name || hostname(), platform);
    writeCredentials(credentials);
    clack.log.success(
      `Enrolled as ${credentials.machine.name} in ${credentials.workspace.name}. Token saved to ${credentialsPath()}.`,
    );
  } else {
    clack.log.info(
      `Machine ${credentials.machine.name} in ${credentials.workspace.name} (${credentials.server})`,
    );
  }

  const runner = await ensureRunner({ log: (line) => clack.log.info(line) });

  // First Ctrl-C goes offline and lets a running job's runner exit and clean up (the terminal
  // sends it SIGINT too). A second one exits on the spot.
  const stop = new AbortController();
  process.on("SIGINT", () => {
    if (stop.signal.aborted) process.exit(130);
    stop.abort();
  });

  const end = await connect({
    server: credentials.server,
    token: credentials.token,
    hello: { machineId: credentials.machine.id, ...platform, runnerVersion: runner.version },
    runJob: (run, report) => runJob(run, { runner, report }),
    onEvent: show,
    signal: stop.signal,
  });

  switch (end.reason) {
    case "stopped":
      clack.outro("Offline.");
      break;
    case "revoked":
      deleteCredentials();
      clack.log.error(
        "This machine was removed from the workspace or its token is no longer valid.",
      );
      clack.outro("Run `relayrunner connect` again to sign in.");
      process.exitCode = 1;
      break;
    case "replaced":
      clack.log.warn("Another `relayrunner connect` for this machine took over.");
      clack.outro("Offline here.");
      process.exitCode = 1;
      break;
    case "rejected":
      clack.log.error(`The gateway rejected this CLI: ${end.message}`);
      clack.outro("Update it with `npx relayrunner@latest connect`.");
      process.exitCode = 1;
      break;
  }
}

async function signIn(
  server: string,
  name: string,
  platform: { os: "linux" | "macos"; arch: "x64" | "arm64" },
): Promise<Credentials> {
  const waiting = clack.spinner();
  try {
    const credentials = await login({
      server,
      name,
      platform,
      onCode: ({ userCode, url }) => {
        clack.note(
          `${url}\n\nConfirm the code ${userCode} matches the one in your browser.`,
          "Sign in",
        );
        openBrowser(url);
        waiting.start("Waiting for approval in the browser");
      },
    });
    waiting.stop("Approved");
    return credentials;
  } catch (error) {
    waiting.error("Sign-in failed");
    throw error;
  }
}

function show(event: ConnectionEvent) {
  const at = new Date().toLocaleTimeString();
  switch (event.type) {
    case "connecting":
      if (event.attempt === 1) clack.log.step(`${at} Connecting…`);
      break;
    case "connected":
      clack.log.success(`${at} Online. Waiting for jobs.`);
      break;
    case "disconnected":
      clack.log.warn(
        `${at} Disconnected (${event.code}${event.reason ? ` ${event.reason}` : ""}). Retrying in ${Math.ceil(event.retryInMs / 1000)}s.`,
      );
      break;
    case "gateway-error":
      clack.log.error(`${at} Gateway: ${event.message}`);
      break;
    case "run":
      clack.log.step(`${at} Starting job ${event.routeId}`);
      break;
    case "run-refused":
      clack.log.warn(`${at} Turned down job ${event.routeId}: already running one.`);
      break;
    case "job": {
      const { routeId, state, message } = event.update;
      const line = `${at} Job ${routeId} ${state}${message ? `: ${message}` : ""}`;
      if (state === "failed") clack.log.error(line);
      else if (state === "finished") clack.log.success(line);
      else clack.log.info(line);
      break;
    }
  }
}

function normalizeServer(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.origin;
  } catch {
    throw new RunnerError("USAGE", `Not a valid RelayRunner URL: ${value}`);
  }
}

const main = defineCommand({
  meta: {
    name: "relayrunner",
    description: "Run GitHub Actions jobs on your machine through the RelayRunner gateway.",
  },
  subCommands: { connect: connectCommand },
});

void runMain(main);
