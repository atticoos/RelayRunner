import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";
import { createAuth } from "./auth.ts";
import * as testing from "./testing.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;

const pem = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

beforeAll(async () => {
  ({ proxy, env } = await testing.startD1());
  env = {
    ...env,
    GITHUB_APP_ID: "5605512",
    GITHUB_APP_PRIVATE_KEY: { get: async () => pem } as SecretsStoreSecret,
  };
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

// The JIT config requests GitHub saw, as [org, body].
let minted: [string, unknown][] = [];

beforeEach(() => {
  minted = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (/\/app\/installations\/\d+\/access_tokens$/.test(url))
      return Response.json({ token: "ghs_installation" });
    const org = url.match(/\/orgs\/([^/]+)\/actions\/runners\/generate-jitconfig$/)?.[1];
    if (org) {
      minted.push([org, JSON.parse(String(init?.body))]);
      return Response.json({ runner: { id: 42 }, encoded_jit_config: "ZW5jb2RlZA==" });
    }
    return realFetch(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let count = 0;

async function ownerWithOrg(org: string, accountType = "Organization") {
  count += 1;
  const { cookie } = await testing.signIn(env);
  const { workspace, cookie: jar } = await testing.createWorkspace(
    env,
    cookie,
    `Debug ${count}`,
    `debug-test-${count}`,
  );
  await createDb(env.DB)
    .insert(schema.githubInstallation)
    .values({
      id: 9000 + count,
      workspaceId: workspace.id,
      accountId: 7000 + count,
      accountLogin: org,
      accountType,
    });
  return { workspace, cookie: jar };
}

const mint = (cookie: string, body: unknown) =>
  testing.call(env, "/debug/jit-config", cookie, body);

describe("POST /debug/jit-config", () => {
  test("mints an rr-test org runner for a connected org", async () => {
    const { cookie } = await ownerWithOrg("Relay-Org");
    const response = await mint(cookie, { org: "relay-org" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      org: "Relay-Org",
      label: "rr-test",
      runnerId: 42,
      jitConfig: "ZW5jb2RlZA==",
    });
    expect(minted).toEqual([
      [
        "Relay-Org",
        {
          name: expect.stringMatching(/^relayrunner-debug-[\da-f]{8}$/),
          labels: ["rr-test"],
          runner_group_id: 1,
          work_folder: "_work",
        },
      ],
    ]);
  });

  test("refuses an org this workspace hasn't connected", async () => {
    const { cookie } = await ownerWithOrg("mine");
    await ownerWithOrg("theirs");
    const response = await mint(cookie, { org: "theirs" });
    expect(response.status).toBe(404);
    expect(minted).toEqual([]);
  });

  test("refuses a personal account", async () => {
    const { cookie } = await ownerWithOrg("someone", "User");
    expect((await mint(cookie, { org: "someone" })).status).toBe(404);
  });

  test("refuses a member who isn't the owner", async () => {
    const { workspace } = await ownerWithOrg("team-org");
    const member = await testing.signIn(env);
    const ctx = await createAuth(env).$context;
    await ctx.adapter.create({
      model: "member",
      data: {
        organizationId: workspace.id,
        userId: member.user.id,
        role: "member",
        createdAt: new Date(),
      },
    });
    const active = await testing.call(env, "/auth/organization/set-active", member.cookie, {
      organizationId: workspace.id,
    });
    expect(active.status).toBe(200);
    const response = await mint(testing.withSetCookies(member.cookie, active), { org: "team-org" });
    expect(response.status).toBe(403);
  });

  test("rejects a body without an org", async () => {
    const { cookie } = await ownerWithOrg("bad-body");
    expect((await mint(cookie, {})).status).toBe(400);
  });

  test("needs a signed-in user", async () => {
    expect((await mint("", { org: "x" })).status).toBe(401);
  });
});
