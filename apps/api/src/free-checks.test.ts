import type { ActivityPage } from "@relayrunner/activity";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";
import { type FreeCheck, type FreeCheckSavings, recordFreeCheck } from "./free-checks.ts";
import * as testing from "./testing.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;

beforeAll(async () => {
  ({ proxy, env } = await testing.startD1());
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

let ids = 0;

async function connectedWorkspace() {
  ids += 1;
  const { cookie: signedIn } = await testing.signIn(env);
  const { workspace, cookie } = await testing.createWorkspace(
    env,
    signedIn,
    `Checks ${ids}`,
    `checks-${ids}`,
  );
  const installationId = 7000 + ids;
  const db = createDb(env.DB);
  await db.insert(schema.githubInstallation).values({
    id: installationId,
    workspaceId: workspace.id,
    accountId: installationId,
    accountLogin: `checks-org-${ids}`,
    accountType: "Organization",
  });
  const repo = (offset: number, name: string, isPrivate: boolean) => ({
    id: installationId * 10 + offset,
    installationId,
    fullName: `acme/${name}`,
    private: isPrivate,
    githubStateAt: new Date(),
  });
  await db
    .insert(schema.githubRepository)
    .values([repo(0, "private", true), repo(1, "public", false)]);
  return { cookie, installationId };
}

function check(installationId: number, repo: "private" | "public" | "unmirrored"): FreeCheck {
  const offset = { private: 0, public: 1, unmirrored: 2 }[repo];
  return {
    check: "PR title",
    repository: `acme/${repo}`,
    repositoryId: installationId * 10 + offset,
    pullRequest: 12,
    headSha: "abc123",
    conclusion: "success",
    url: `https://github.com/acme/${repo}/runs/1`,
  };
}

async function get<T>(path: string, cookie: string) {
  const res = await testing.call(env, path, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("free check savings", () => {
  test("counts a billed Linux minute per check run, free in public repos", async () => {
    const { cookie, installationId } = await connectedWorkspace();
    const db = createDb(env.DB);
    await recordFreeCheck(db, installationId, check(installationId, "private"));
    await recordFreeCheck(db, installationId, check(installationId, "private"));
    await recordFreeCheck(db, installationId, check(installationId, "public"));
    // A repo the gateway hasn't mirrored yet counts as private.
    await recordFreeCheck(db, installationId, check(installationId, "unmirrored"));

    const savings = await get<FreeCheckSavings>("/usage/checks", cookie);
    expect(savings).toMatchObject({
      days: 30,
      runner: { label: "Linux 2-core", perMinute: 0.006 },
      checks: 4,
      savedCost: 0.018,
    });
    expect(savings.byRepository).toEqual([
      { repository: "acme/private", private: true, checks: 2, savedCost: 0.012 },
      { repository: "acme/unmirrored", private: null, checks: 1, savedCost: 0.006 },
      { repository: "acme/public", private: false, checks: 1, savedCost: 0 },
    ]);
  });

  test("logs each check run on the Activity page", async () => {
    const { cookie, installationId } = await connectedWorkspace();
    await recordFreeCheck(createDb(env.DB), installationId, {
      ...check(installationId, "private"),
      conclusion: "failure",
    });
    const page = await get<ActivityPage>("/activity?filter=check", cookie);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: "check.completed",
      data: { check: "PR title", repository: "acme/private", conclusion: "failure" },
    });
  });

  test("leaves out other workspaces, older runs, and installations without a row", async () => {
    const { installationId } = await connectedWorkspace();
    const db = createDb(env.DB);
    await recordFreeCheck(db, installationId, check(installationId, "private"));
    expect(await recordFreeCheck(db, 999_999, check(999_999, "private"))).toBe(false);

    const { cookie, installationId: mine } = await connectedWorkspace();
    await recordFreeCheck(db, mine, check(mine, "private"));
    expect((await get<FreeCheckSavings>("/usage/checks?days=7", cookie)).checks).toBe(1);
  });
});
