// The messages a machine and the gateway exchange over the machine WebSocket. The API's
// MachineLink Durable Object holds one end and `relayrunner connect` holds the other.
//
// Every message is a JSON text frame carrying the protocol version in `v`. Either side rejects a
// message whose version it doesn't speak, so a gateway deploy and an older CLI fail loudly
// instead of misreading each other. Bump PROTOCOL_VERSION for any change an older peer would
// misread; adding an optional field doesn't need a bump.
//
// Auth isn't part of the protocol: the machine token goes on the WebSocket upgrade request.

import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const version = z.literal(PROTOCOL_VERSION);

// A route is one pick that chose a machine. Its id is the suffix of the `rr-<route id>` label
// GitHub queues the job on.
const routeId = z.string().min(1);

// machine → gateway

// First message after the socket opens. The gateway doesn't route to the machine until it has
// one.
export const HelloMessage = z.object({
  v: version,
  type: z.literal("hello"),
  machineId: z.string().min(1),
  os: z.enum(["linux", "macos", "windows"]),
  arch: z.enum(["x64", "arm64", "arm"]),
  // The actions/runner version installed on the machine, such as "2.329.0".
  runnerVersion: z.string().min(1),
});

// Sent whenever the machine's state changes and again on an interval as its heartbeat.
export const StatusMessage = z.object({
  v: version,
  type: z.literal("status"),
  state: z.enum(["idle", "busy"]),
});

// Progress of the runner process the machine started for a `run` message. "finished" means the
// runner exited cleanly, not that the job passed: the job's conclusion comes from GitHub's
// workflow_job webhook. "failed" means the runner couldn't start or exited with an error.
export const JobMessage = z.object({
  v: version,
  type: z.literal("job"),
  routeId,
  state: z.enum(["started", "finished", "failed"]),
  message: z.string().optional(),
});

export const MachineMessage = z.discriminatedUnion("type", [
  HelloMessage,
  StatusMessage,
  JobMessage,
]);

// gateway → machine

// Run one job: start `run.sh --jitconfig <jitConfig>` in a fresh work directory. The config is
// GitHub's encoded_jit_config for a one-job runner, so it's only good for this job.
export const RunMessage = z.object({
  v: version,
  type: z.literal("run"),
  routeId,
  jitConfig: z.string().min(1),
});

// Sent just before the gateway closes the socket because of something the machine sent.
export const ErrorMessage = z.object({
  v: version,
  type: z.literal("error"),
  code: z.enum(["version_mismatch", "invalid_message"]),
  message: z.string(),
});

export const GatewayMessage = z.discriminatedUnion("type", [RunMessage, ErrorMessage]);

export type HelloMessage = z.infer<typeof HelloMessage>;
export type StatusMessage = z.infer<typeof StatusMessage>;
export type JobMessage = z.infer<typeof JobMessage>;
export type MachineMessage = z.infer<typeof MachineMessage>;
export type RunMessage = z.infer<typeof RunMessage>;
export type ErrorMessage = z.infer<typeof ErrorMessage>;
export type GatewayMessage = z.infer<typeof GatewayMessage>;

export type ParseResult<T> =
  | { ok: true; message: T }
  // invalid_json: the frame isn't JSON. version_mismatch: `v` is missing or isn't
  // PROTOCOL_VERSION. invalid_message: right version, wrong shape.
  | { ok: false; reason: "invalid_json" | "version_mismatch" | "invalid_message"; error: string };

// A text frame from the machine → typed message, or why it was rejected. Never throws.
export function parseMachineMessage(frame: string): ParseResult<MachineMessage> {
  return parse(MachineMessage, frame);
}

// A text frame from the gateway → typed message, or why it was rejected. Never throws.
export function parseGatewayMessage(frame: string): ParseResult<GatewayMessage> {
  return parse(GatewayMessage, frame);
}

// Typed message → text frame. Either side should only send what its schema allows.
export function encodeMessage(message: MachineMessage | GatewayMessage): string {
  return JSON.stringify(message);
}

function parse<T>(schema: z.ZodType<T>, frame: string): ParseResult<T> {
  let data: unknown;
  try {
    data = JSON.parse(frame);
  } catch (error) {
    return { ok: false, reason: "invalid_json", error: String(error) };
  }

  // Check the version before the shape, so a peer on another version gets a version error
  // rather than a confusing complaint about a field that changed.
  const v = typeof data === "object" && data !== null ? (data as { v?: unknown }).v : undefined;
  if (v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: "version_mismatch",
      error: `expected protocol version ${PROTOCOL_VERSION}, got ${JSON.stringify(v) ?? "none"}`,
    };
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    return { ok: false, reason: "invalid_message", error: z.prettifyError(result.error) };
  }
  return { ok: true, message: result.data };
}
