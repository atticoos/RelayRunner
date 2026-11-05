import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "./app.ts";
import { createAuth } from "./auth.ts";
import type { Env } from "./env.ts";
import * as testing from "./testing.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;

beforeAll(async () => {
  ({ proxy, env } = await testing.startD1());
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

const signIn = () => testing.signIn(env);
const call = (path: string, cookie: string, body?: unknown) =>
  testing.call(env, path, cookie, body);
const createWorkspace = (cookie: string, name: string, slug: string) =>
  testing.createWorkspace(env, cookie, name, slug);

describe("workspaces", () => {
  test("a signed-out request is rejected", async () => {
    const response = await app.request("/api/workspaces/current", {}, env);
    expect(response.status).toBe(401);
  });

  test("a signed-in user without a workspace gets no_active_workspace", async () => {
    const { cookie } = await signIn();
    const response = await call("/workspaces/current", cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_active_workspace" });
  });

  test("a user creates a workspace, owns it, and it becomes active", async () => {
    const { user, cookie } = await signIn();
    const { workspace, cookie: jar } = await createWorkspace(cookie, "Acme", "acme");
    expect(workspace.slug).toBe("acme");
    expect(workspace.members).toEqual([
      expect.objectContaining({ userId: user.id, role: "owner" }),
    ]);

    const current = await call("/workspaces/current", jar);
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({
      workspace: expect.objectContaining({ id: workspace.id, name: "Acme", slug: "acme" }),
      role: "owner",
      installations: [],
    });

    const row = await env.DB.prepare(
      "select workspace_id, user_id, role from workspace_member where workspace_id = ?",
    )
      .bind(workspace.id)
      .first();
    expect(row).toEqual({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  });

  test("a workspace lists only its own GitHub installations", async () => {
    const { cookie } = await signIn();
    const {
      workspace: { id },
      cookie: jar,
    } = await createWorkspace(cookie, "Globex", "globex");
    const now = Date.now();
    const insert = env.DB.prepare(
      "insert into github_installation (id, workspace_id, account_id, account_login, account_type, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)",
    );
    await env.DB.batch([
      insert.bind(1, id, 10, "globex", "Organization", now, now),
      insert.bind(2, id, 11, "globex-labs", "Organization", now, now),
      insert.bind(3, null, 12, "unclaimed", "User", now, now),
    ]);

    const current = await call("/workspaces/current", jar);
    const body = (await current.json()) as { installations: { accountLogin: string }[] };
    expect(body.installations.map((installation) => installation.accountLogin)).toEqual([
      "globex",
      "globex-labs",
    ]);
  });

  test("a workspace has one member for now", async () => {
    const { cookie } = await signIn();
    const {
      workspace: { id },
    } = await createWorkspace(cookie, "Initech", "initech");
    const other = await signIn();
    const added = await createAuth(env)
      .api.addMember({ body: { organizationId: id, userId: other.user.id, role: "member" } })
      .then(
        () => "added",
        (error: { body?: { code?: string } }) => error.body?.code,
      );
    expect(added).toBe("ORGANIZATION_MEMBERSHIP_LIMIT_REACHED");
  });

  test("a workspace slug is unique", async () => {
    const { cookie } = await signIn();
    const response = await call("/auth/organization/create", cookie, {
      name: "Acme again",
      slug: "acme",
    });
    expect(response.status).toBe(400);
  });
});

describe("runner order", () => {
  const put = (id: string, cookie: string, body: unknown) =>
    app.request(
      `/api/workspaces/${id}/runner-order`,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json", origin: env.BETTER_AUTH_URL },
        body: JSON.stringify(body),
      },
      env,
    );

  test("a new workspace reads the default order: machine, then github", async () => {
    const { cookie } = await signIn();
    const { workspace, cookie: jar } = await createWorkspace(cookie, "Order", "order-default");
    const response = await call(`/workspaces/${workspace.id}/runner-order`, jar);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      order: { steps: [{ key: "machine" }, { key: "github" }] },
      isDefault: true,
    });
  });

  test("a member saves an order and reads it back", async () => {
    const { cookie } = await signIn();
    const { workspace, cookie: jar } = await createWorkspace(cookie, "Order", "order-save");
    const order = { steps: [{ key: "github" }, { key: "machine" }] };
    const saved = await put(workspace.id, jar, order);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ order, isDefault: false });

    const read = await call(`/workspaces/${workspace.id}/runner-order`, jar);
    expect(await read.json()).toEqual({ order, isDefault: false });
    const row = await env.DB.prepare("select runner_order from workspace where id = ?")
      .bind(workspace.id)
      .first<{ runner_order: string }>();
    expect(JSON.parse(row!.runner_order)).toEqual(order);
  });

  test("an empty order or a repeated provider is rejected with a reason", async () => {
    const { cookie } = await signIn();
    const { workspace, cookie: jar } = await createWorkspace(cookie, "Order", "order-invalid");

    const empty = await put(workspace.id, jar, { steps: [] });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({
      error: "invalid_runner_order",
      issues: [{ path: ["steps"], message: "Add at least one provider." }],
    });

    const twice = await put(workspace.id, jar, { steps: [{ key: "github" }, { key: "github" }] });
    expect(twice.status).toBe(400);
    expect(await twice.json()).toMatchObject({
      issues: [{ path: ["steps", 1, "key"], message: "GitHub-hosted is already in the order." }],
    });

    const unknown = await put(workspace.id, jar, { steps: [{ key: "blacksmith" }] });
    expect(unknown.status).toBe(400);

    const read = await call(`/workspaces/${workspace.id}/runner-order`, jar);
    expect(await read.json()).toMatchObject({ isDefault: true });
  });

  test("someone outside the workspace can't read or change its order", async () => {
    const { cookie } = await signIn();
    const { workspace } = await createWorkspace(cookie, "Order", "order-private");
    const { cookie: outsider } = await signIn();

    const read = await call(`/workspaces/${workspace.id}/runner-order`, outsider);
    expect(read.status).toBe(404);
    const write = await put(workspace.id, outsider, { steps: [{ key: "github" }] });
    expect(write.status).toBe(404);

    const signedOut = await app.request(`/api/workspaces/${workspace.id}/runner-order`, {}, env);
    expect(signedOut.status).toBe(401);
  });
});
