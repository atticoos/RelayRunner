import { escapeHtml, renderEmailCard, strong, type RenderedEmail } from "./card.ts";

/**
 * Security notice when a machine finishes `relayrunner connect`. A machine token can pick up the
 * workspace's CI jobs, so the person who approved it hears about it, and can revoke it if it
 * wasn't them.
 */
export function renderMachineConnectedEmail(ctx: {
  machineName: string;
  os?: string | null;
  arch?: string | null;
  workspaceName: string;
  connectedAt: Date;
  machinesUrl: string;
}): RenderedEmail {
  const platform = [ctx.os, ctx.arch].filter(Boolean).join(" ");
  const machine = platform ? `${ctx.machineName} (${platform})` : ctx.machineName;
  const when = ctx.connectedAt.toUTCString();
  return renderEmailCard({
    subject: `New machine connected to ${ctx.workspaceName}`,
    preheader: `${machine} can now run ${ctx.workspaceName}'s CI jobs.`,
    eyebrow: "Security",
    title: "A machine was connected",
    bodyHtml: [
      `${strong(machine)} was connected to ${strong(ctx.workspaceName)} with your approval on ${escapeHtml(when)}.`,
      "<br><br>",
      "It can now run the workspace's CI jobs whenever they are routed to it.",
    ].join(""),
    text: [
      "A machine was connected",
      "",
      `${machine} was connected to ${ctx.workspaceName} with your approval on ${when}.`,
      "It can now run the workspace's CI jobs whenever they are routed to it.",
      "",
      `Not you? Revoke it: ${ctx.machinesUrl}`,
    ].join("\n"),
    cta: { url: ctx.machinesUrl, label: "Review machines →" },
    footNoteHtml: "If you didn't run <code>relayrunner connect</code>, revoke this machine now.",
  });
}
