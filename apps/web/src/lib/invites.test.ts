import { describe, expect, test } from "vitest";
import { inviteView, inviterName, type Invite } from "./invites.ts";

const invite = (rest: Partial<Invite>): Invite => ({
  id: "inv_1",
  email: "zach@acme.dev",
  role: "member",
  status: "pending",
  expiresAt: new Date(0).toISOString(),
  workspace: { id: "ws_1", name: "Acme" },
  inviter: { name: "Atticus" },
  emailMatches: true,
  alreadyMember: false,
  ...rest,
});

describe("inviteView", () => {
  test("offers accept for a live invite to this email", () => {
    expect(inviteView(invite({}))).toEqual({ kind: "pending" });
  });

  test("flags an email mismatch on a live invite", () => {
    expect(inviteView(invite({ emailMatches: false }))).toEqual({ kind: "mismatch" });
  });

  test("explains a closed invite before an email mismatch", () => {
    for (const status of ["expired", "canceled", "rejected"] as const)
      expect(inviteView(invite({ status, emailMatches: false }))).toEqual({
        kind: "closed",
        reason: status,
      });
  });

  test("treats members and accepted invites the same", () => {
    expect(inviteView(invite({ alreadyMember: true }))).toEqual({ kind: "member" });
    expect(inviteView(invite({ status: "accepted" }))).toEqual({ kind: "member" });
    expect(inviteView(invite({ status: "expired", alreadyMember: true }))).toEqual({
      kind: "member",
    });
  });
});

test("inviterName falls back when the inviter is gone", () => {
  expect(inviterName(invite({}))).toBe("Atticus");
  expect(inviterName(invite({ inviter: null }))).toBe("the person who invited you");
});
