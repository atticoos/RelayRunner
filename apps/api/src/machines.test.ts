import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { app } from "./app.ts";
import { createDb } from "./db/index.ts";
import type { Env } from "./env.ts";
import { verifyMachineToken } from "./machines.ts";
import * as testing from "./testing.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;

beforeAll(async () => {
  ({ proxy, env } = await testing.startD1());
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

const call = (path: string, cookie: string, body?: unknown) =>
  testing.call(env, path, cookie, body);

// What `relayrunner connect` does first.
async function requestCode(clientId = "relayrunner-cli") {
  const response = await app.request(
    "/api/auth/device/code",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId }),
    },
    env,
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri_complete: string;
      error?: string;
    },
  };
}

async function pollToken(deviceCode: string) {
  const response = await app.request(
    "/api/auth/device/token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: "relayrunner-cli",
      }),
    },
    env,
  );
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

function claim(accessToken: string, body: unknown) {
  return app.request(
    "/api/machines/claim",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function owner(slug: string) {
  const { cookie } = await testing.signIn(env);
  return testing.createWorkspace(env, cookie, slug, slug);
}

// Runs the whole flow and returns the machine token the CLI would keep.
async function enroll(slug: string, name = "atticus-mbp") {
  const { workspace, cookie } = await owner(slug);
  const { body: code } = await requestCode();
  const approved = await call("/machines/approve", cookie, {
    userCode: code.user_code,
    workspaceId: workspace.id,
    name,
  });
  expect(approved.status).toBe(200);
  const { body: token } = await pollToken(code.device_code);
  const claimed = await claim(token.access_token, {
    deviceCode: code.device_code,
    os: "macos",
    arch: "arm64",
  });
  expect(claimed.status).toBe(200);
  const body = (await claimed.json()) as {
    machine: { id: string; name: string; os: string };
    workspace: { id: string };
    token: string;
  };
  return { ...body, cookie, workspaceId: workspace.id, accessToken: token.access_token, code };
}

describe("machine enrollment", () => {
  test("device codes are only issued to the relayrunner CLI", async () => {
    const { status, body } = await requestCode("someone-else");
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_client");
  });

  test("the verification link points at the dashboard's /device page", async () => {
    const { body } = await requestCode();
    expect(body.verification_uri_complete).toBe(
      `http://localhost:8787/device?user_code=${body.user_code}`,
    );
  });

  test("the CLI waits until the code is approved", async () => {
    const { body } = await requestCode();
    const { status, body: error } = await pollToken(body.device_code);
    expect(status).toBe(400);
    expect(error.error).toBe("authorization_pending");
  });

  test("approve, poll and claim yields a machine token for the chosen workspace", async () => {
    const { machine, workspace, token, workspaceId, accessToken } = await enroll("enroll-ok");
    expect(token).toMatch(/^rrm_[\w-]{43}$/);
    expect(workspace.id).toBe(workspaceId);
    expect(machine).toMatchObject({ name: "atticus-mbp", os: "macos" });

    const db = createDb(env.DB);
    expect(await verifyMachineToken(db, token)).toMatchObject({ id: machine.id, workspaceId });
    expect(await verifyMachineToken(db, "rrm_nope")).toBeNull();
    expect(await verifyMachineToken(db, accessToken)).toBeNull();

    // Only the hash is stored.
    const row = await env.DB.prepare("select token_hash, enrollment_hash from machine where id = ?")
      .bind(machine.id)
      .first<{ token_hash: string; enrollment_hash: string | null }>();
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.enrollment_hash).toBeNull();
  });

  test("the device-flow user session is revoked by the claim", async () => {
    const { accessToken, code } = await enroll("enroll-session");
    const me = await app.request(
      "/api/me",
      { headers: { authorization: `Bearer ${accessToken}` } },
      env,
    );
    expect(me.status).toBe(401);
    // And the same code can't claim twice (the session is gone, and so is the enrollment).
    const again = await claim(accessToken, {
      deviceCode: code.device_code,
      os: "macos",
      arch: "arm64",
    });
    expect(again.status).toBe(401);
  });

  test("a user can't approve into a workspace they aren't in", async () => {
    const { workspace } = await owner("enroll-theirs");
    const { cookie } = await testing.signIn(env);
    const { body: code } = await requestCode();
    const response = await call("/machines/approve", cookie, {
      userCode: code.user_code,
      workspaceId: workspace.id,
      name: "intruder",
    });
    expect(response.status).toBe(403);
  });

  test("a code another user opened can't be approved", async () => {
    const first = await owner("enroll-first");
    const second = await owner("enroll-second");
    const { body: code } = await requestCode();
    expect((await call(`/auth/device?user_code=${code.user_code}`, first.cookie)).status).toBe(200);
    const response = await call("/machines/approve", second.cookie, {
      userCode: code.user_code,
      workspaceId: second.workspace.id,
      name: "stolen",
    });
    expect(response.status).toBe(403);
    expect(
      await env.DB.prepare("select count(*) as n from machine where name = 'stolen'").first(),
    ).toEqual({ n: 0 });
  });

  test("an approved code can't be approved again", async () => {
    const { workspace, cookie } = await owner("enroll-twice");
    const { body: code } = await requestCode();
    const body = { userCode: code.user_code, workspaceId: workspace.id, name: "once" };
    expect((await call("/machines/approve", cookie, body)).status).toBe(200);
    expect((await call("/machines/approve", cookie, body)).status).toBe(409);
  });

  test("the user code is accepted with its dash and in lowercase", async () => {
    const { workspace, cookie } = await owner("enroll-dash");
    const { body: code } = await requestCode();
    const userCode = `${code.user_code.slice(0, 4)}-${code.user_code.slice(4)}`.toLowerCase();
    const response = await call("/machines/approve", cookie, {
      userCode,
      workspaceId: workspace.id,
      name: "dashed",
    });
    expect(response.status).toBe(200);
  });

  test("claim checks the body and the device code", async () => {
    const { workspace, cookie } = await owner("enroll-claim");
    const { body: code } = await requestCode();
    await call("/machines/approve", cookie, {
      userCode: code.user_code,
      workspaceId: workspace.id,
      name: "box",
    });
    const { body: token } = await pollToken(code.device_code);
    expect(
      (await claim(token.access_token, { deviceCode: code.device_code, os: "beos", arch: "x64" }))
        .status,
    ).toBe(400);
    expect(
      (await claim(token.access_token, { deviceCode: "wrong", os: "linux", arch: "x64" })).status,
    ).toBe(404);
  });

  test("a denied code ends the CLI's polling", async () => {
    const { cookie } = await owner("enroll-deny");
    const { body: code } = await requestCode();
    await call(`/auth/device?user_code=${code.user_code}`, cookie);
    expect((await call("/auth/device/deny", cookie, { userCode: code.user_code })).status).toBe(
      200,
    );
    const { body } = await pollToken(code.device_code);
    expect(body.error).toBe("access_denied");
  });
});

describe("machines in the dashboard", () => {
  test("lists the active workspace's enrolled machines", async () => {
    const { cookie, machine } = await enroll("list-ok", "build-box");
    // An approved but unclaimed code doesn't show up.
    const { body: code } = await requestCode();
    const { workspace } = (await (await call("/workspaces/current", cookie)).json()) as {
      workspace: { id: string };
    };
    await call("/machines/approve", cookie, {
      userCode: code.user_code,
      workspaceId: workspace.id,
      name: "never-claimed",
    });

    const response = await call("/machines", cookie);
    expect(response.status).toBe(200);
    const { machines } = (await response.json()) as { machines: Record<string, unknown>[] };
    expect(machines).toEqual([
      expect.objectContaining({ id: machine.id, name: "build-box", os: "macos", arch: "arm64" }),
    ]);
    expect(machines[0]).not.toHaveProperty("tokenHash");
  });

  test("revoking a machine kills its token and hides it", async () => {
    const { cookie, machine, token } = await enroll("revoke-ok");
    const response = await app.request(
      `/api/machines/${machine.id}`,
      { method: "DELETE", headers: { cookie, origin: env.BETTER_AUTH_URL } },
      env,
    );
    expect(response.status).toBe(200);
    expect(await verifyMachineToken(createDb(env.DB), token)).toBeNull();
    const { machines } = (await (await call("/machines", cookie)).json()) as {
      machines: unknown[];
    };
    expect(machines).toEqual([]);
  });

  test("another workspace can't revoke the machine", async () => {
    const { machine, token } = await enroll("revoke-mine");
    const other = await owner("revoke-other");
    const response = await app.request(
      `/api/machines/${machine.id}`,
      { method: "DELETE", headers: { cookie: other.cookie } },
      env,
    );
    expect(response.status).toBe(404);
    expect(await verifyMachineToken(createDb(env.DB), token)).not.toBeNull();
  });
});
