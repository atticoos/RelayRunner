import { escapeHtml, renderEmailCard, strong, type RenderedEmail } from "./card.ts";

/**
 * A workspace invite (#135). The link opens the dashboard's accept page, which asks the
 * recipient to sign in with the GitHub account that has this email address.
 */
export function renderInviteEmail(ctx: {
  inviterName: string;
  workspaceName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const role = ctx.role === "admin" ? "an admin" : ctx.role === "owner" ? "an owner" : "a member";
  const expires = ctx.expiresAt.toUTCString();
  return renderEmailCard({
    subject: `${ctx.inviterName} invited you to ${ctx.workspaceName} on RelayRunner`,
    preheader: `Join ${ctx.workspaceName} to share its CI machines.`,
    eyebrow: "Invite",
    title: `Join ${ctx.workspaceName}`,
    bodyHtml: [
      `${strong(ctx.inviterName)} invited you to join ${strong(ctx.workspaceName)} on RelayRunner as ${escapeHtml(role)}.`,
      "<br><br>",
      "Members share the workspace's machines: your jobs can run on theirs, and theirs on any machine you connect.",
    ].join(""),
    text: [
      `Join ${ctx.workspaceName}`,
      "",
      `${ctx.inviterName} invited you to join ${ctx.workspaceName} on RelayRunner as ${role}.`,
      "Members share the workspace's machines: your jobs can run on theirs, and theirs on any machine you connect.",
      "",
      `Accept: ${ctx.acceptUrl}`,
      `This invite expires ${expires}.`,
    ].join("\n"),
    cta: { url: ctx.acceptUrl, label: "Accept the invite →" },
    footNoteHtml: `Sign in with the GitHub account that uses this email address. The invite expires ${escapeHtml(expires)}. If you weren't expecting it, you can ignore this email.`,
  });
}
