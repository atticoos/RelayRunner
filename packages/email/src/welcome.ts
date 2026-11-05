import { code, link, renderEmailCard, type RenderedEmail } from "./card.ts";

const DOCS = "https://github.com/relayrunner/relayrunner#readme";

/** First sign-in: point at the one command that gets a machine connected. */
export function renderWelcomeEmail(ctx: { name?: string; dashboardUrl: string }): RenderedEmail {
  const dashboardUrl = ctx.dashboardUrl.replace(/\/$/, "");
  const name = ctx.name?.trim();
  const hello = name ? `Hi ${name},` : "Hi,";
  return renderEmailCard({
    subject: "Welcome to RelayRunner",
    preheader: "Connect your machine with relayrunner connect, then route a job to it.",
    eyebrow: "Welcome",
    title: "You're in",
    bodyHtml: [
      `${hello} your RelayRunner account is ready.`,
      "<br><br>",
      `Run ${code("relayrunner connect")} on the machine you want CI jobs to run on. It opens the dashboard so you can approve it, and from then on your agent can switch opted-in jobs to that machine and back.`,
      "<br><br>",
      `Setup notes live in the ${link(DOCS, "README")}.`,
    ].join(""),
    text: [
      "Welcome to RelayRunner",
      "",
      `${hello} your RelayRunner account is ready.`,
      "",
      "Run `relayrunner connect` on the machine you want CI jobs to run on. It opens the dashboard so you can approve it, and from then on your agent can switch opted-in jobs to that machine and back.",
      "",
      `Dashboard: ${dashboardUrl}`,
      `Setup notes: ${DOCS}`,
    ].join("\n"),
    cta: { url: dashboardUrl, label: "Open the dashboard →" },
    footNoteHtml: "You're getting this because you signed in to RelayRunner with GitHub.",
  });
}
