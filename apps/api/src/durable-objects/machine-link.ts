import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env.ts";

// One per enrolled machine. Holds the `relayrunner agent` WebSocket, so a live connection means the
// machine is online. Routers ask it whether it can take a job.
export class MachineLink extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket")
      return new Response("Expected a WebSocket.", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async isOnline(): Promise<boolean> {
    return this.ctx.getWebSockets().length > 0;
  }
}
