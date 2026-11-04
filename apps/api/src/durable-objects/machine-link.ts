import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createDb, schema } from "../db/index.ts";
import type { Env } from "../env.ts";
import {
  CLOSE,
  handleFrame,
  HEARTBEAT_TIMEOUT_MS,
  isStale,
  MACHINE_ID_HEADER,
  newSession,
  OFFLINE,
  statusOf,
  type MachineStatus,
  type SessionState,
} from "./machine-session.ts";

// One per enrolled machine, addressed by machine id. Holds the machine's `relayrunner connect`
// WebSocket, so a live socket that has said hello means the machine is online. Uses the
// hibernation API: each socket's SessionState lives in its attachment, not in memory.
export class MachineLink extends DurableObject<Env> {
  // Called by GET /api/machines/connect once the machine token checks out.
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket.", { status: 426 });
    const machineId = request.headers.get(MACHINE_ID_HEADER);
    if (!machineId) return new Response("Missing machine id.", { status: 400 });

    // One socket per machine: a newer connection wins, so a restarted CLI never waits for the
    // old socket to time out.
    for (const old of this.ctx.getWebSockets()) close(old, CLOSE.replaced, "replaced");

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment(newSession(machineId, now));
    await this.ctx.storage.setAlarm(now + HEARTBEAT_TIMEOUT_MS);
    await this.touch(machineId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, frame: string | ArrayBuffer) {
    const session = attachment(ws);
    if (!session) return close(ws, CLOSE.policy, "unknown socket");
    const outcome = handleFrame(session, frame, Date.now());
    ws.serializeAttachment(outcome.state);
    if ("reply" in outcome) {
      ws.send(outcome.reply);
      close(ws, outcome.close.code, outcome.close.reason);
      await this.touch(session.machineId);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Finish the closing handshake; the machine started it.
    close(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
    const session = attachment(ws);
    if (session) await this.touch(session.machineId);
  }

  async webSocketError(ws: WebSocket) {
    const session = attachment(ws);
    if (session) await this.touch(session.machineId);
  }

  // Closes sockets that have gone quiet, and checks again while any remain.
  async alarm() {
    const now = Date.now();
    let earliest: number | undefined;
    for (const ws of this.ctx.getWebSockets()) {
      const session = attachment(ws);
      if (!session || isStale(session, now)) {
        close(ws, CLOSE.timeout, "heartbeat timeout");
        if (session) await this.touch(session.machineId);
        continue;
      }
      earliest = Math.min(earliest ?? Infinity, session.lastHeardAt);
    }
    if (earliest !== undefined) await this.ctx.storage.setAlarm(earliest + HEARTBEAT_TIMEOUT_MS);
  }

  /** Online (said hello, heard from within the heartbeat timeout), idle or busy. */
  async status(): Promise<MachineStatus> {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const status = statusOf(attachment(ws), now);
      if (status.online) return status;
    }
    return OFFLINE;
  }

  /** Closes the machine's socket for good. DELETE /api/machines/:id calls this on revoke. */
  async revoke(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) close(ws, CLOSE.revoked, "revoked");
  }

  // last_seen_at is written when a connection opens or ends, not on every heartbeat. While the
  // machine is online, status() is the live answer.
  private async touch(machineId: string) {
    await createDb(this.env.DB)
      .update(schema.machine)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.machine.id, machineId));
  }
}

function attachment(ws: WebSocket) {
  return ws.deserializeAttachment() as SessionState | null;
}

// Closing an already-closed socket throws; that's fine here.
function close(ws: WebSocket, code: number, reason: string) {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}
