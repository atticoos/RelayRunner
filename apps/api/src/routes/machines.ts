import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { APIError } from "better-auth/api";
import { HelloMessage } from "@relayrunner/machine-protocol";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { MACHINE_CLIENT_ID } from "../auth.ts";
import { createDb, schema } from "../db/index.ts";
import { isWorkspaceMember } from "../installations.ts";
import { generateMachineToken, normalizeUserCode, presentMachine, sha256Hex } from "../machines.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

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

const MANAGER_ROLES = new Set(["owner", "admin"]);

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
    if (!membership || !MANAGER_ROLES.has(membership.role))
      return c.json({ error: "forbidden" }, 403);

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

    // The CLI is done with the user session; only the machine token stays on the machine.
    await db.delete(schema.session).where(eq(schema.session.id, c.var.session!.id));

    const [workspace] = await db
      .select({ id: schema.workspace.id, name: schema.workspace.name, slug: schema.workspace.slug })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, machine.workspaceId))
      .limit(1);
    return c.json({ machine: presentMachine(machine), workspace, token });
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
    return c.json({ machines: machines.map(presentMachine) });
  })
  .delete("/:id", requireUser, requireWorkspace, async (c) => {
    if (!MANAGER_ROLES.has(c.var.role)) return c.json({ error: "forbidden" }, 403);
    const [machine] = await c.var.db
      .update(schema.machine)
      // Dropping the hash too means the token can never match again, whatever reads it.
      .set({ revokedAt: new Date(), tokenHash: null, enrollmentHash: null })
      .where(
        and(
          eq(schema.machine.id, c.req.param("id")),
          eq(schema.machine.workspaceId, c.var.workspace.id),
          isNull(schema.machine.revokedAt),
        ),
      )
      .returning();
    if (!machine) return c.json({ error: "not_found" }, 404);
    // TODO(#66): tell the machine's MachineLink to close its socket.
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
