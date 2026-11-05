import { describe, expect, it } from "vitest";
import {
  renderDeadLetterAlertEmail,
  renderInviteEmail,
  renderMachineConnectedEmail,
  renderWelcomeEmail,
} from "./index.ts";

describe("templates", () => {
  it("welcome links the dashboard in both bodies", () => {
    const email = renderWelcomeEmail({ name: "Ada", dashboardUrl: "https://app.example/" });
    expect(email.subject).toBe("Welcome to RelayRunner");
    expect(email.text).toContain("Hi Ada,");
    expect(email.text).toContain("Dashboard: https://app.example");
    expect(email.html).toContain('href="https://app.example"');
  });

  it("machine-connected escapes user-chosen names in HTML", () => {
    const email = renderMachineConnectedEmail({
      machineName: "<script>alert(1)</script>",
      os: "macos",
      arch: "arm64",
      workspaceName: "Acme & Co",
      connectedAt: new Date("2026-11-05T00:00:00Z"),
      machinesUrl: "https://app.example/runners",
    });
    expect(email.subject).toBe("New machine connected to Acme & Co");
    expect(email.html).not.toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Acme &amp; Co");
    expect(email.text).toContain("(macos arm64)");
    expect(email.text).toContain("Not you? Revoke it: https://app.example/runners");
  });

  it("dead-letter alert counts deliveries", () => {
    const email = renderDeadLetterAlertEmail({
      count: 12,
      threshold: 10,
      inspectorUrl: "https://app.example/dev/webhooks",
    });
    expect(email.subject).toBe("[webhooks] 12 deliveries dead-lettered in the past hour");
    expect(email.text).toContain("https://app.example/dev/webhooks");
  });

  it("invite links the accept page and escapes names", () => {
    const email = renderInviteEmail({
      inviterName: "Ada <ada>",
      workspaceName: "Acme & Co",
      role: "admin",
      acceptUrl: "https://app.example/invite/inv_1",
      expiresAt: new Date("2026-11-07T00:00:00Z"),
    });
    expect(email.subject).toBe("Ada <ada> invited you to Acme & Co on RelayRunner");
    expect(email.html).toContain("Ada &lt;ada&gt;");
    expect(email.html).toContain('href="https://app.example/invite/inv_1"');
    expect(email.text).toContain("as an admin");
    expect(email.text).toContain("Accept: https://app.example/invite/inv_1");
  });
});
