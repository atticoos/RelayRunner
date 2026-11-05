import { api } from "@/lib/api";
import { organization } from "@/lib/auth-client";

// The Members page (#136) reads and writes through Better Auth's stock organization endpoints
// (/api/auth/organization/*); the gateway adds only machine counts.

export type Member = {
  id: string;
  userId: string;
  role: string;
  createdAt: string | Date;
  user: { id: string; name: string; email: string; image?: string | null };
};

export type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | Date;
  inviterId: string;
};

export type MembersData = {
  members: Member[];
  /** Pending invites, newest first. Expired ones stay so they can be resent. */
  invitations: Invitation[];
  /** Live machines each user enrolled, by user id. */
  machineCounts: Record<string, number>;
};

/** Better Auth's error code, or a generic message, as a thrown Error. */
function fail(error: { code?: string; message?: string } | null, fallback: string): never {
  throw Object.assign(new Error(error?.message || fallback), { code: error?.code });
}

export async function getMembersData(workspaceId: string): Promise<MembersData> {
  const [members, invitations, counts] = await Promise.all([
    organization.listMembers({ query: { organizationId: workspaceId, limit: 200 } }),
    organization.listInvitations({ query: { organizationId: workspaceId } }),
    api<{ counts: Record<string, number> }>("/workspaces/current/machine-counts"),
  ]);
  if (members.error) fail(members.error, "Couldn't load members.");
  if (invitations.error) fail(invitations.error, "Couldn't load invites.");
  return {
    members: members.data.members as Member[],
    invitations: (invitations.data as Invitation[])
      .filter((invitation) => invitation.status === "pending")
      .sort((a, b) => +new Date(b.expiresAt) - +new Date(a.expiresAt)),
    machineCounts: counts.counts,
  };
}

export async function inviteMember(
  workspaceId: string,
  email: string,
  role: string,
  resend = false,
) {
  const { error } = await organization.inviteMember({
    organizationId: workspaceId,
    email,
    role: role as "member",
    resend,
  });
  if (error) fail(error, "Couldn't send the invite.");
}

export async function cancelInvitation(invitationId: string) {
  const { error } = await organization.cancelInvitation({ invitationId });
  if (error) fail(error, "Couldn't cancel the invite.");
}

export async function updateMemberRole(workspaceId: string, memberId: string, role: string) {
  const { error } = await organization.updateMemberRole({
    organizationId: workspaceId,
    memberId,
    role: role as "member",
  });
  if (error) fail(error, "Couldn't change the role.");
}

export async function removeMember(workspaceId: string, memberId: string) {
  const { error } = await organization.removeMember({
    organizationId: workspaceId,
    memberIdOrEmail: memberId,
  });
  if (error) fail(error, "Couldn't remove them.");
}

/** Leaves the workspace and switches to another one, if the user has any. */
export async function leaveWorkspace(workspaceId: string) {
  const { error } = await organization.leave({ organizationId: workspaceId });
  if (error) fail(error, "Couldn't leave the workspace.");
  const { data: rest } = await organization.list();
  const next = rest?.find((workspace) => workspace.id !== workspaceId);
  if (next) await organization.setActive({ organizationId: next.id });
  return next ?? null;
}

/** A friendlier line for Better Auth's error codes. */
export function memberErrorMessage(error: unknown, fallback: string) {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION":
      return "They're already a member of this workspace.";
    case "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE":
      return "Only owners can invite owners.";
    case "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER":
    case "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER":
      return "A workspace needs at least one owner. Make someone else an owner first.";
    case "INVITATION_LIMIT_REACHED":
      return "Too many pending invites. Cancel some first.";
    default:
      return fallback;
  }
}
