// What MachineLink does with each frame a machine sends, kept free of Durable Object APIs so it
// can be tested on its own. MachineLink stores a SessionState as each socket's attachment, so it
// survives the object hibernating between frames.

import {
  encodeMessage,
  parseMachineMessage,
  PROTOCOL_VERSION,
  type HelloMessage,
  type JobMessage,
} from "@relayrunner/machine-protocol";

// The header GET /api/machines/connect uses to tell MachineLink which machine authenticated.
// MachineLink isn't reachable from outside the API Worker, so only that route can set it.
export const MACHINE_ID_HEADER = "x-relayrunner-machine-id";

// The machine sends `status` at least this often (the CLI's heartbeat is 30 seconds)...
export const HEARTBEAT_INTERVAL_MS = 30_000;
// ...and the gateway closes a socket that has been silent for this long.
export const HEARTBEAT_TIMEOUT_MS = 90_000;

// WebSocket close codes the gateway uses. The CLI reconnects with backoff after any other code.
export const CLOSE = {
  // The machine sent something the protocol doesn't allow. An `error` message comes first.
  policy: 1008,
  // Nothing heard for HEARTBEAT_TIMEOUT_MS. The CLI should reconnect.
  timeout: 4000,
  // The machine was revoked in the dashboard. The CLI should stop and say so.
  revoked: 4001,
  // The same machine opened a newer socket. The CLI holding this one should exit.
  replaced: 4002,
} as const;

export interface SessionState {
  machineId: string;
  connectedAt: number;
  lastHeardAt: number;
  // Set by the machine's `hello`. Until then the machine isn't online.
  hello?: Pick<HelloMessage, "os" | "arch" | "runnerVersion" | "device">;
  state?: "idle" | "busy";
}

export type FrameOutcome =
  // `job` is set when the frame was a job update, for MachineLink to act on.
  | { state: SessionState; job?: JobMessage }
  | { state: SessionState; reply: string; close: { code: number; reason: string } };

export function newSession(machineId: string, now: number): SessionState {
  return { machineId, connectedAt: now, lastHeardAt: now };
}

export function handleFrame(
  session: SessionState,
  frame: string | ArrayBuffer,
  now: number,
): FrameOutcome {
  if (typeof frame !== "string") return reject(session, "invalid_message", "frames must be text");

  const parsed = parseMachineMessage(frame);
  if (!parsed.ok) {
    return reject(
      session,
      parsed.reason === "version_mismatch" ? "version_mismatch" : "invalid_message",
      parsed.error,
    );
  }

  const message = parsed.message;
  const heard = { ...session, lastHeardAt: now };
  if (message.type === "hello") {
    if (session.hello) return reject(session, "invalid_message", "hello was already sent");
    if (message.machineId !== session.machineId)
      return reject(session, "invalid_message", "machineId doesn't match this machine's token");
    const { os, arch, runnerVersion, device } = message;
    // A machine that just said hello has no job from this gateway yet.
    return { state: { ...heard, hello: { os, arch, runnerVersion, device }, state: "idle" } };
  }

  if (!session.hello) return reject(session, "invalid_message", "send hello first");
  if (message.type === "status") return { state: { ...heard, state: message.state } };
  // Job progress for a route. Hearing it still counts as a heartbeat.
  return { state: heard, job: message };
}

export interface MachineStatus {
  online: boolean;
  // Null while offline.
  state: "idle" | "busy" | null;
  // Epoch ms of the current connection, or null while offline.
  connectedAt: number | null;
}

export const OFFLINE: MachineStatus = { online: false, state: null, connectedAt: null };

// A machine is online while it holds a socket that has said hello and isn't stale.
export function statusOf(session: SessionState | null | undefined, now: number): MachineStatus {
  if (!session?.hello || isStale(session, now)) return OFFLINE;
  return { online: true, state: session.state ?? "idle", connectedAt: session.connectedAt };
}

export function isStale(session: SessionState, now: number) {
  return now - session.lastHeardAt > HEARTBEAT_TIMEOUT_MS;
}

function reject(
  session: SessionState,
  code: "version_mismatch" | "invalid_message",
  message: string,
): FrameOutcome {
  return {
    state: session,
    reply: encodeMessage({ v: PROTOCOL_VERSION, type: "error", code, message }),
    close: { code: CLOSE.policy, reason: code },
  };
}
