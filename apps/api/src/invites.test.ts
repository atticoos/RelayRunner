import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { app } from "./app.ts";
import type { Env } from "./env.ts";
import * as testing from "./testing.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;
let sent: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  const started = await testing.startD1();
  proxy = started.proxy;
  env = {
    ...started.env,
    DASHBOARD_URL: "https://app.example",
    EMAIL: {
      send: async (message: { to: string; subject: string; text: string }) => {
        // Signing in test users sends welcome emails too; keep only invites.
        if (message.subject.includes(" invited you to ")) sent.push(message);
        return { messageId: "m" };
      },
    } as unknown as Env["EMAIL"],
  };
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(() => {
  sent = [];
});

const call = (path: string, cookie: string, body?: unknown) =>
  testing.call(env, path, cookie, body);

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  emailMatches: boolean;
  alreadyMember: boolean;
  workspace: { id: string; name: string };
  inviter: { name: string } | null;
};

let slugs = 0;
async function ownerWithWorkspace() {
  const owner = await testing.signIn(env);
  slugs += 1;
  const { workspace, cookie } = await testing.createWorkspace(
    env,
    owner.cookie,
    "Acme",
    `invites-${slugs}`,
  );
  return { owner, workspace, cookie };
}

async function invite(cookie: string, workspaceId: string, email: string, role = "member") {
  return call("/auth/organization/invite-member", cookie, {
    organizationId: workspaceId,
    email,
    role,
  });
}

async function readInvite(id: string, cookie: string) {
  const response = await call(`/invites/${id}`, cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { invite: Invite }).invite;
}

async function activityTypes(cookie: string) {
  const response = await call("/activity?filter=member", cookie);
  expect(response.status).toBe(200);
  const page = (await response.json()) as {
    items: { type: string; data: Record<string, unknown>; actor: { id: string } | null }[];
  };
  return page.items;
}

describe("invites", () => {
  test("an owner invites by email: the invitee gets a link to the accept page", async () => {
    const { owner, workspace, cookie } = await ownerWithWorkspace();
    const response = await invite(cookie, workspace.id, "Ada@Example.com", "admin");
    expect(response.status).toBe(200);
    const created = (await response.json()) as { id: string; email: string };
    expect(created.email).toBe("ada@example.com");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("ada@example.com");
    expect(sent[0].subject).toBe(`${owner.user.name} invited you to Acme on RelayRunner`);
    expect(sent[0].text).toContain(`https://app.example/invite/${created.id}`);

    const [event] = await activityTypes(cookie);
    expect(event).toMatchObject({
      type: "member.invited",
      data: { email: "ada@example.com", role: "admin" },
      actor: { id: owner.user.id },
    });
  });

  test("a member can't invite, and an admin can't invite an owner", async () => {
    const { workspace } = await ownerWithWorkspace();
    const member = await testing.joinWorkspace(env, workspace.id, "member");
    expect((await invite(member.cookie, workspace.id, "x@example.com")).status).toBe(403);

    const admin = await testing.joinWorkspace(env, workspace.id, "admin");
    expect((await invite(admin.cookie, workspace.id, "y@example.com", "owner")).status).toBe(403);
    expect((await invite(admin.cookie, workspace.id, "y@example.com", "admin")).status).toBe(200);
  });

  test("the invitee sees the invite, accepts it, and joins", async () => {
    const { owner, workspace, cookie } = await ownerWithWorkspace();
    const invitee = await testing.signIn(env);
    const created = (await (await invite(cookie, workspace.id, invitee.user.email)).json()) as {
      id: string;
    };

    expect(await readInvite(created.id, invitee.cookie)).toMatchObject({
      email: invitee.user.email,
      role: "member",
      status: "pending",
      emailMatches: true,
      alreadyMember: false,
      workspace: { id: workspace.id, name: "Acme" },
      inviter: { name: owner.user.name },
    });

    const accepted = await call("/auth/organization/accept-invitation", invitee.cookie, {
      invitationId: created.id,
    });
    expect(accepted.status).toBe(200);
    expect(await readInvite(created.id, invitee.cookie)).toMatchObject({
      status: "accepted",
      alreadyMember: true,
    });

    const [event] = await activityTypes(cookie);
    expect(event).toMatchObject({
      type: "member.joined",
      data: { name: invitee.user.name, email: invitee.user.email, role: "member" },
      actor: { id: invitee.user.id },
    });
  });

  test("someone signed in with another email sees the mismatch and can't accept", async () => {
    const { workspace, cookie } = await ownerWithWorkspace();
    const created = (await (await invite(cookie, workspace.id, "ada@example.com")).json()) as {
      id: string;
    };
    const other = await testing.signIn(env);
    expect(await readInvite(created.id, other.cookie)).toMatchObject({
      email: "ada@example.com",
      emailMatches: false,
    });
    const accepted = await call("/auth/organization/accept-invitation", other.cookie, {
      invitationId: created.id,
    });
    expect(accepted.status).toBe(403);
  });

  test("inviting the same email again cancels the old link and sends a new one", async () => {
    const { workspace, cookie } = await ownerWithWorkspace();
    const invitee = await testing.signIn(env);
    const first = (await (await invite(cookie, workspace.id, invitee.user.email)).json()) as {
      id: string;
    };
    const second = (await (await invite(cookie, workspace.id, invitee.user.email)).json()) as {
      id: string;
    };
    expect(second.id).not.toBe(first.id);
    expect(sent.map((message) => message.to)).toEqual([invitee.user.email, invitee.user.email]);
    expect((await readInvite(first.id, invitee.cookie)).status).toBe("canceled");
    expect((await readInvite(second.id, invitee.cookie)).status).toBe("pending");
  });

  test("an owner cancels an invite: it's logged and the link stops working", async () => {
    const { owner, workspace, cookie } = await ownerWithWorkspace();
    const invitee = await testing.signIn(env);
    const created = (await (await invite(cookie, workspace.id, invitee.user.email)).json()) as {
      id: string;
    };
    const canceled = await call("/auth/organization/cancel-invitation", cookie, {
      invitationId: created.id,
    });
    expect(canceled.status).toBe(200);
    expect((await readInvite(created.id, invitee.cookie)).status).toBe("canceled");
    const accepted = await call("/auth/organization/accept-invitation", invitee.cookie, {
      invitationId: created.id,
    });
    expect(accepted.status).toBe(400);

    const [event] = await activityTypes(cookie);
    expect(event).toMatchObject({
      type: "member.invite_canceled",
      data: { email: invitee.user.email, role: "member" },
      actor: { id: owner.user.id },
    });
  });

  test("a member can't cancel an invite", async () => {
    const { workspace, cookie } = await ownerWithWorkspace();
    const created = (await (await invite(cookie, workspace.id, "ada@example.com")).json()) as {
      id: string;
    };
    const member = await testing.joinWorkspace(env, workspace.id, "member");
    const canceled = await call("/auth/organization/cancel-invitation", member.cookie, {
      invitationId: created.id,
    });
    expect(canceled.status).toBe(403);
  });

  test("an invite past its 48 hours reads as expired", async () => {
    const { workspace, cookie } = await ownerWithWorkspace();
    const invitee = await testing.signIn(env);
    const created = (await (await invite(cookie, workspace.id, invitee.user.email)).json()) as {
      id: string;
      expiresAt: string;
    };
    const hours = (new Date(created.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);

    await env.DB.prepare("update workspace_invitation set expires_at = ? where id = ?")
      .bind(Date.now() - 1000, created.id)
      .run();
    expect((await readInvite(created.id, invitee.cookie)).status).toBe("expired");
  });

  test("an unknown invite is a 404, and reading one needs sign-in", async () => {
    const { cookie } = await testing.signIn(env);
    expect((await call("/invites/nope", cookie)).status).toBe(404);
    expect((await app.request("/api/invites/nope", {}, env)).status).toBe(401);
  });
});
