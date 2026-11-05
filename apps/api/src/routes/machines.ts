import { recordEvent } from "../activity.ts";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { APIError } from "better-auth/api";
import { HelloMessage } from "@relayrunner/machine-protocol";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { MACHINE_CLIENT_ID } from "../auth.ts";
import { createDb, schema } from "../db/index.ts";
import { isWorkspaceMember } from "../installations.ts";
import { MACHINE_ID_HEADER } from "../durable-objects/machine-session.ts";
import {
  generateMachineToken,
  normalizeUserCode,
  presentMachine,
  sha256Hex,
  verifyMachineToken,
} from "../machines.ts";
import { sendEmail } from "../email.ts";
import { requireUser, waitUntil } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";
import { canManage, canRevokeMachine } from "../roles.ts";

// Enrolling a machine (`relayrunner connect`) with Better Auth's device authorization plugin:
//
// 1. The CLI asks for a code: POST /api/auth/device/code with client_id "relayrunner-cli". It
//    opens the returned verification_uri_complete (the dashboard's /device page), adding
//    &name=<hostname> as the default machine name, and polls /api/auth/device/token.
// 2. On /device the signed-in user picks a workspace and a name, and approves: POST /approve
//    below. That creates the machine (unclaimed, keyed by a hash of the device code) and approves
//    the code. Deny goes straight to /api/auth/device/deny.
// 3. The CLI's next poll returns a user session token. It calls POST /claim below with that
//    session as a bearer token plus the device code, gets the machine token back once, and the
//    session is revoked. From then on the machine authenticates as itself.
//
// A code approved but never claimed leaves an unclaimed row that nothing lists or accepts.
//
// Once enrolled, the CLI stays connected over GET /connect below, a WebSocket to the machine's
// MachineLink Durable Object speaking @relayrunner/machine-protocol.

const ApproveBody = z.object({
  userCode: z.string().min(1).max(64),
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(64),
});

const ClaimBody = z.object({
  deviceCode: z.string().min(1),
  os: HelloMessage.shape.os,
  arch: HelloMessage.shape.arch,
});

export const machineRoutes = new Hono<AppEnv>()
  .post("/approve", requireUser, async (c) => {
    const parsed = ApproveBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const { workspaceId, name } = parsed.data;
    const userCode = normalizeUserCode(parsed.data.userCode);
    const user = c.var.user!;
    const db = createDb(c.env.DB);

    const membership = await isWorkspaceMember(db, workspaceId, user.id);
    // Any member can enroll a machine into the shared pool (#134).
    if (!membership) return c.json({ error: "forbidden" }, 403);

    // Opening the code ties it to this user (Better Auth only lets that user approve it). The
    // dashboard has already done this, but doing it here keeps the endpoint whole on its own.
    try {
      await c.var.auth.api.deviceVerify({
        query: { user_code: userCode },
        headers: c.req.raw.headers,
      });
    } catch (error) {
      return deviceError(error);
    }

    const [code] = await db
      .select()
      .from(schema.deviceCode)
      .where(eq(schema.deviceCode.userCode, userCode))
      .limit(1);
    if (!code || code.expiresAt < new Date()) return c.json({ error: "expired_token" }, 400);
    if (code.clientId !== MACHINE_CLIENT_ID) return c.json({ error: "invalid_request" }, 400);
    if (code.status !== "pending") return c.json({ error: "already_processed" }, 409);
    if (code.userId !== user.id) return c.json({ error: "forbidden" }, 403);

    const machineId = crypto.randomUUID();
    await db.insert(schema.machine).values({
      id: machineId,
      workspaceId,
      name,
      enrollmentHash: await sha256Hex(code.deviceCode),
      createdBy: user.id,
    });

    try {
      await c.var.auth.api.deviceApprove({ body: { userCode }, headers: c.req.raw.headers });
    } catch (error) {
      await db.delete(schema.machine).where(eq(schema.machine.id, machineId));
      return deviceError(error);
    }
    return c.json({ machineId });
  })
  // Called by the CLI with the device-flow session as `Authorization: Bearer <token>`.
  .post("/claim", requireUser, async (c) => {
    const parsed = ClaimBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const { deviceCode, os, arch } = parsed.data;
    const db = createDb(c.env.DB);

    const token = generateMachineToken();
    // The enrollment hash is cleared in the same statement, so a code claims at most once.
    const [machine] = await db
      .update(schema.machine)
      .set({ os, arch, tokenHash: await sha256Hex(token), enrollmentHash: null })
      .where(
        and(
          eq(schema.machine.enrollmentHash, await sha256Hex(deviceCode)),
          eq(schema.machine.createdBy, c.var.user!.id),
          isNull(schema.machine.revokedAt),
        ),
      )
      .returning();
    if (!machine) return c.json({ error: "not_found" }, 404);
    await recordEvent(db, {
      workspaceId: machine.workspaceId,
      type: "machine.enrolled",
      data: { machineName: machine.name, os: machine.os, arch: machine.arch },
      machineId: machine.id,
      actorUserId: c.var.user!.id,
    });

    // The CLI is done with the user session; only the machine token stays on the machine.
    await db.delete(schema.session).where(eq(schema.session.id, c.var.session!.id));

    const [workspace] = await db
      .select({ id: schema.workspace.id, name: schema.workspace.name, slug: schema.workspace.slug })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, machine.workspaceId))
      .limit(1);

    // Security notice to whoever approved the machine: its token can run the workspace's jobs.
    const notice = sendEmail(c.env, {
      to: c.var.user!.email,
      template: "machine-connected",
      context: {
        machineName: machine.name,
        os: machine.os,
        arch: machine.arch,
        workspaceName: workspace?.name ?? "your workspace",
        connectedAt: new Date(),
      },
    });
    const defer = waitUntil(c);
    if (defer) defer(notice);
    else await notice;
    return c.json({ machine: presentMachine(machine), workspace, token });
  })
  // The machine's WebSocket: `Upgrade: websocket` with `Authorization: Bearer rrm_…`. A missing,
  // unknown or revoked token gets a 401 before the upgrade. After that the machine sends `hello`,
  // then `status` as a heartbeat (src/durable-objects/machine-session.ts has the timings and
  // close codes). The token is checked first because a failed upgrade hides its status from the
  // CLI, so it asks with a plain GET: 401 means sign in again, 426 means the token is fine.
  .get("/connect", async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const machine = await verifyMachineToken(createDb(c.env.DB), token);
    if (!machine) return c.json({ error: "unauthorized" }, 401);
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
      return c.json({ error: "upgrade_required" }, 426);

    const headers = new Headers(c.req.raw.headers);
    headers.delete("authorization");
    headers.set(MACHINE_ID_HEADER, machine.id);
    return c.env.MACHINE_LINK.getByName(machine.id).fetch(new Request(c.req.raw, { headers }));
  })
  // Who a machine token belongs to, for `relayrunner whoami`: `Authorization: Bearer rrm_…`. A
  // missing, unknown or revoked token gets a 401, the same as /connect.
  .get("/me", async (c) => {
    const token = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const db = createDb(c.env.DB);
    const machine = await verifyMachineToken(db, token);
    if (!machine) return c.json({ error: "unauthorized" }, 401);

    const [[workspace], [enrolledBy], status] = await Promise.all([
      db
        .select({
          id: schema.workspace.id,
          name: schema.workspace.name,
          slug: schema.workspace.slug,
        })
        .from(schema.workspace)
        .where(eq(schema.workspace.id, machine.workspaceId))
        .limit(1),
      machine.createdBy
        ? db
            .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, machine.createdBy))
            .limit(1)
        : Promise.resolve([]),
      c.env.MACHINE_LINK.getByName(machine.id).status(),
    ]);
    return c.json({
      machine: { ...presentMachine(machine), status },
      workspace,
      enrolledBy: enrolledBy ?? null,
    });
  })
  .get("/", requireUser, requireWorkspace, async (c) => {
    const machines = await c.var.db
      .select()
      .from(schema.machine)
      .where(
        and(
          eq(schema.machine.workspaceId, c.var.workspace.id),
          isNotNull(schema.machine.os),
          isNull(schema.machine.revokedAt),
        ),
      )
      .orderBy(asc(schema.machine.name));
    // Live status from each machine's MachineLink. Fine for a handful of machines per workspace.
    const statuses = await Promise.all(
      machines.map((machine) => c.env.MACHINE_LINK.getByName(machine.id).status()),
    );
    return c.json({
      machines: machines.map((machine, i) => ({
        ...presentMachine(machine),
        status: statuses[i],
        // Whether the signed-in user may revoke it (#134), so the dashboard can hide the action.
        canRevoke: canRevokeMachine(c.var.role, c.var.user!.id, machine),
      })),
    });
  })
  .delete("/:id", requireUser, requireWorkspace, async (c) => {
    const machineId = c.req.param("id");
    const { role, user, workspace, db } = c.var;
    const live = and(
      eq(schema.machine.id, machineId),
      eq(schema.machine.workspaceId, workspace.id),
      isNull(schema.machine.revokedAt),
    );
    // Owners and admins can revoke any machine; members only the ones they enrolled. The check
    // rides in the update so the common case is one query.
    const [machine] = await db
      .update(schema.machine)
      // Dropping the hash too means the token can never match again, whatever reads it.
      .set({ revokedAt: new Date(), tokenHash: null, enrollmentHash: null })
      .where(canManage(role) ? live : and(live, eq(schema.machine.createdBy, user!.id)))
      .returning();
    if (!machine) {
      // Nothing changed: tell a member a machine they can see apart from one that isn't there.
      const [exists] = await db
        .select({ id: schema.machine.id })
        .from(schema.machine)
        .where(live)
        .limit(1);
      return exists ? c.json({ error: "forbidden" }, 403) : c.json({ error: "not_found" }, 404);
    }
    await recordEvent(c.var.db, {
      workspaceId: machine.workspaceId,
      type: "machine.revoked",
      data: { machineName: machine.name },
      machineId: machine.id,
      actorUserId: c.var.user!.id,
    });
    // The token can't open a new socket any more; close the one that's open.
    await c.env.MACHINE_LINK.getByName(machine.id).revoke();
    return c.json({ machine: presentMachine(machine) });
  });

// Better Auth's device errors carry an RFC 8628 code in the body; pass it through.
function deviceError(error: unknown) {
  if (error instanceof APIError) {
    const body = error.body as { error?: string } | undefined;
    return Response.json({ error: body?.error ?? "invalid_request" }, { status: error.statusCode });
  }
  throw error;
}
