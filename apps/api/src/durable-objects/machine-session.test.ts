import {
  encodeMessage,
  PROTOCOL_VERSION,
  type MachineMessage,
} from "@relayrunner/machine-protocol";
import { describe, expect, test } from "vitest";
import {
  CLOSE,
  handleFrame,
  HEARTBEAT_TIMEOUT_MS,
  newSession,
  statusOf,
  type SessionState,
} from "./machine-session.ts";

type Unversioned = MachineMessage extends infer M
  ? M extends MachineMessage
    ? Omit<M, "v">
    : never
  : never;
const frame = (message: Unversioned) =>
  encodeMessage({ v: PROTOCOL_VERSION, ...message } as MachineMessage);
const hello = frame({
  type: "hello",
  machineId: "m1",
  os: "macos",
  arch: "arm64",
  runnerVersion: "2.329.0",
});

function said(frames: string[], start = 0) {
  let session: SessionState = newSession("m1", start);
  for (const [i, f] of frames.entries()) {
    const outcome = handleFrame(session, f, start + (i + 1) * 1000);
    expect(outcome).not.toHaveProperty("reply");
    session = outcome.state;
  }
  return session;
}

function rejected(session: SessionState, f: string | ArrayBuffer) {
  const outcome = handleFrame(session, f, 0);
  if (!("reply" in outcome)) throw new Error("expected a rejection");
  return {
    error: JSON.parse(outcome.reply) as { type: string; code: string },
    close: outcome.close,
  };
}

describe("machine session", () => {
  test("a connected machine isn't online until it says hello", () => {
    expect(statusOf(newSession("m1", 0), 0).online).toBe(false);
    expect(statusOf(said([hello]), 1000)).toEqual({ online: true, state: "idle", connectedAt: 0 });
  });

  test("status messages set idle or busy", () => {
    const busy = said([hello, frame({ type: "status", state: "busy" })]);
    expect(statusOf(busy, 2000).state).toBe("busy");
    const idle = said([
      hello,
      frame({ type: "status", state: "busy" }),
      frame({ type: "status", state: "idle" }),
    ]);
    expect(statusOf(idle, 3000).state).toBe("idle");
  });

  test("any message counts as a heartbeat; silence past the timeout reads as offline", () => {
    const session = said([hello, frame({ type: "job", routeId: "r1", state: "started" })]);
    expect(session.lastHeardAt).toBe(2000);
    expect(statusOf(session, 2000 + HEARTBEAT_TIMEOUT_MS).online).toBe(true);
    expect(statusOf(session, 2001 + HEARTBEAT_TIMEOUT_MS).online).toBe(false);
  });

  test("hello must come first, once, and match the token's machine", () => {
    const fresh = newSession("m1", 0);
    expect(rejected(fresh, frame({ type: "status", state: "idle" })).error.code).toBe(
      "invalid_message",
    );
    expect(rejected(said([hello]), hello).error.code).toBe("invalid_message");
    const other = hello.replace('"m1"', '"m2"');
    expect(rejected(fresh, other).error).toMatchObject({ type: "error", code: "invalid_message" });
  });

  test("bad frames get an error message, then a policy close", () => {
    const fresh = newSession("m1", 0);
    expect(rejected(fresh, "not json")).toMatchObject({
      error: { code: "invalid_message" },
      close: { code: CLOSE.policy },
    });
    expect(rejected(fresh, JSON.stringify({ v: 99, type: "hello" })).error.code).toBe(
      "version_mismatch",
    );
    expect(rejected(fresh, new ArrayBuffer(4)).error.code).toBe("invalid_message");
  });
});
