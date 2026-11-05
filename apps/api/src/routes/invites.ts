import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { createDb, schema } from "../db/index.ts";
import { requireUser } from "../middleware/session.ts";

export const INVITE_STATUSES = ["pending", "accepted", "rejected", "canceled", "expired"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

// Sending, cancelling, listing, accepting and declining invites use Better Auth's organization
// endpoints (/api/auth/organization/invite-member, cancel-invitation, list-invitations,
// accept-invitation, reject-invitation). Its get-invitation only answers the invitee about a live
// invite, so the accept page (#137) reads this instead: it also explains an expired or cancelled
// invite and an email mismatch. Anyone signed in with the link's id can read it; ids are random.
export const inviteRoutes = new Hono<AppEnv>().get("/:id", requireUser, async (c) => {
  const db = createDb(c.env.DB);
  const user = c.var.user!;
  const [row] = await db
    .select({
      invitation: schema.workspaceInvitation,
      workspaceName: schema.workspace.name,
      inviterName: schema.user.name,
    })
    .from(schema.workspaceInvitation)
    .innerJoin(schema.workspace, eq(schema.workspace.id, schema.workspaceInvitation.workspaceId))
    .leftJoin(schema.user, eq(schema.user.id, schema.workspaceInvitation.inviterId))
    .where(eq(schema.workspaceInvitation.id, c.req.param("id")))
    .limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  const { invitation } = row;
  const [membership] = await db
    .select({ id: schema.workspaceMember.id })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, invitation.workspaceId),
        eq(schema.workspaceMember.userId, user.id),
      ),
    )
    .limit(1);
  // Better Auth leaves an unanswered invite "pending" past its expiry.
  const status: InviteStatus =
    invitation.status === "pending" && invitation.expiresAt < new Date()
      ? "expired"
      : (invitation.status as InviteStatus);
  return c.json({
    invite: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status,
      expiresAt: invitation.expiresAt.toISOString(),
      workspace: { id: invitation.workspaceId, name: row.workspaceName },
      inviter: row.inviterName === null ? null : { name: row.inviterName },
      // Accepting needs these to match (case-insensitively, like Better Auth).
      emailMatches: invitation.email.toLowerCase() === user.email.toLowerCase(),
      alreadyMember: membership !== undefined,
    },
  });
});
