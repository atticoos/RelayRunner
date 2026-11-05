import { api } from "./api.ts";

/** GET /api/invites/:id (apps/api/src/routes/invites.ts). */
export type Invite = {
  id: string;
  email: string;
  role: string;
  status: "pending" | "accepted" | "rejected" | "canceled" | "expired";
  expiresAt: string;
  workspace: { id: string; name: string };
  inviter: { name: string } | null;
  emailMatches: boolean;
  alreadyMember: boolean;
};

export async function getInvite(id: string) {
  const { invite } = await api<{ invite: Invite }>(`/invites/${encodeURIComponent(id)}`);
  return invite;
}

/** What the accept page shows for an invite, most specific first. */
export type InviteView =
  | { kind: "member" }
  | { kind: "closed"; reason: "expired" | "canceled" | "rejected" }
  | { kind: "mismatch" }
  | { kind: "pending" };

export function inviteView(invite: Invite): InviteView {
  // Already in the workspace: nothing to accept, whatever the invite's state.
  if (invite.alreadyMember || invite.status === "accepted") return { kind: "member" };
  if (invite.status !== "pending") return { kind: "closed", reason: invite.status };
  if (!invite.emailMatches) return { kind: "mismatch" };
  return { kind: "pending" };
}

/** "the person who invited you" when the inviter's account is gone. */
export function inviterName(invite: Invite) {
  return invite.inviter?.name ?? "the person who invited you";
}
