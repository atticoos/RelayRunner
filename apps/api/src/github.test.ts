import { toWebhookMessage } from "@relayrunner/github-webhooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { app } from "./app.ts";
import type { Env } from "./env.ts";
import { type GitHubInstallation, verifyInstallState } from "./github.ts";
import * as testing from "./testing.ts";
import { processWebhook } from "./webhook-queue.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;

beforeAll(async () => {
  ({ proxy, env } = await testing.startD1());
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

// What GET /user/installations returns per bearer token. Tokens in `revoked` get a 401. Other URLs
// go to the real fetch, which Miniflare may be using.
const visibleTo = new Map<string, GitHubInstallation[]>();
const revoked = new Set<string>();

beforeEach(() => {
  visibleTo.clear();
  revoked.clear();
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://api.github.com/user/installations")) return realFetch(input, init);
    const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
    if (revoked.has(token)) return Promise.resolve(new Response("{}", { status: 401 }));
    const installations = visibleTo.get(token) ?? [];
    return Promise.resolve(Response.json({ total_count: installations.length, installations }));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let nextId = 100;

function installation(overrides: Partial<GitHubInstallation> = {}): GitHubInstallation {
  nextId += 1;
  return {
    id: nextId,
    account: { id: nextId + 5000, login: `org-${nextId}`, type: "Organization" },
    repository_selection: "all",
    suspended_at: null,
    ...overrides,
  };
}

let workspaces = 0;

// A signed-in owner of a fresh workspace.
async function owner() {
  const { user, githubToken, cookie } = await testing.signIn(env);
  workspaces += 1;
  const { workspace, cookie: jar } = await testing.createWorkspace(
    env,
    cookie,
    `Workspace ${workspaces}`,
    `github-test-${workspaces}`,
  );
  return { user, githubToken, workspace, cookie: jar };
}

const call = (path: string, cookie: string, body?: unknown) =>
  testing.call(env, path, cookie, body);

// The `state` the install link would carry for this user's active workspace.
async function installState(cookie: string) {
  const response = await call("/github/install", cookie);
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location")!).searchParams.get("state")!;
}

async function setup(cookie: string, installationId: number, state?: string) {
  const query = new URLSearchParams({
    installation_id: String(installationId),
    setup_action: "install",
  });
  if (state) query.set("state", state);
  const response = await call(`/github/setup?${query}`, cookie);
  expect(response.status).toBe(302);
  return response.headers.get("location");
}

async function listed(cookie: string) {
  const response = await call("/workspaces/current", cookie);
  return ((await response.json()) as { installations: Record<string, unknown>[] }).installations;
}

async function unclaimed(cookie: string) {
  const response = await call("/github/installations/unclaimed", cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { installations: { id: number }[] }).installations.map(
    (row) => row.id,
  );
}

const claim = (cookie: string, installationId: number) =>
  call(`/github/installations/${installationId}/claim`, cookie, {});

// A GitHub delivery as it reaches the API: through the ingress Worker's message shape and the
// queue consumer.
async function webhook(event: string, payload: unknown, receivedAt?: string) {
  const message = toWebhookMessage(event, crypto.randomUUID(), payload, receivedAt);
  expect(message).not.toBeNull();
  await processWebhook(env, message!);
}

const row = (id: number) =>
  env.DB.prepare(
    "select workspace_id, account_login, repository_selection, suspended_at from github_installation where id = ?",
  )
    .bind(id)
    .first();

describe("connecting a GitHub org", () => {
  test("/install redirects to the App install page with a state naming the workspace and user", async () => {
    const { user, workspace, cookie } = await owner();
    const response = await call("/github/install", cookie);
    expect(response.status).toBe(302);

    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(
      "https://github.com/apps/relayrunner-test/installations/new",
    );
    const state = await verifyInstallState(
      env.BETTER_AUTH_SECRET,
      location.searchParams.get("state")!,
    );
    expect(state).toMatchObject({ workspaceId: workspace.id, userId: user.id });
  });

  test("/install needs a signed-in user", async () => {
    const response = await app.request("/api/github/install", {}, env);
    expect(response.status).toBe(401);
  });

  test("setup with a valid state links the installation to the workspace", async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation({ repository_selection: "selected" });
    visibleTo.set(githubToken, [github]);

    expect(await setup(cookie, github.id, await installState(cookie))).toBe(
      "/workspace?github=connected",
    );

    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id });
    expect(await listed(cookie)).toEqual([
      {
        id: github.id,
        accountLogin: github.account!.login,
        accountType: "Organization",
        repositorySelection: "selected",
        suspendedAt: null,
        settingsUrl: `https://github.com/organizations/${github.account!.login}/settings/installations/${github.id}`,
      },
    ]);
  });

  test("a personal account links to the personal settings page", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation({ account: { id: 77, login: "octocat", type: "User" } });
    visibleTo.set(githubToken, [github]);

    await setup(cookie, github.id, await installState(cookie));

    expect(await listed(cookie)).toEqual([
      expect.objectContaining({
        accountType: "User",
        settingsUrl: `https://github.com/settings/installations/${github.id}`,
      }),
    ]);
  });

  test("an installation the token cannot see is not found and not linked", async () => {
    const { cookie } = await owner();
    const github = installation();

    expect(await setup(cookie, github.id, await installState(cookie))).toBe(
      "/workspace?github=not_found",
    );

    expect(await row(github.id)).toBeNull();
    expect(await listed(cookie)).toEqual([]);
    expect(await unclaimed(cookie)).toEqual([]);
    expect((await claim(cookie, github.id)).status).toBe(404);
  });

  test("an installation in another workspace is taken, through setup and through claim", async () => {
    const first = await owner();
    const second = await owner();
    const github = installation();
    visibleTo.set(first.githubToken, [github]);
    visibleTo.set(second.githubToken, [github]);
    await setup(first.cookie, github.id, await installState(first.cookie));

    expect(await setup(second.cookie, github.id, await installState(second.cookie))).toBe(
      "/workspace?github=taken",
    );
    expect(await setup(second.cookie, github.id)).toBe("/workspace?github=taken");

    const claimed = await claim(second.cookie, github.id);
    expect(claimed.status).toBe(409);
    expect(await claimed.json()).toEqual({ error: "installation_in_another_workspace" });

    expect(await unclaimed(second.cookie)).toEqual([]);
    expect(await row(github.id)).toMatchObject({ workspace_id: first.workspace.id });
  });

  test("an install with no state stays unclaimed until the user claims it", async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);

    expect(await setup(cookie, github.id)).toBe("/workspace?github=unclaimed");
    expect(await row(github.id)).toMatchObject({ workspace_id: null });
    expect(await unclaimed(cookie)).toEqual([github.id]);

    const claimed = await claim(cookie, github.id);
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ ok: true });

    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id });
    expect(await unclaimed(cookie)).toEqual([]);
    expect(await listed(cookie)).toEqual([expect.objectContaining({ id: github.id })]);
  });

  test("unclaimed lists only what the token can see, and picks up installs the webhook missed", async () => {
    const { githubToken, cookie } = await owner();
    const mine = installation();
    const theirs = installation();
    visibleTo.set(githubToken, [mine]);
    await webhook("installation", { action: "created", installation: theirs });

    expect(await unclaimed(cookie)).toEqual([mine.id]);
  });

  test("coming back after changing an installation on GitHub reads as updated", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    visibleTo.set(githubToken, [{ ...github, repository_selection: "selected" }]);

    expect(await setup(cookie, github.id)).toBe("/workspace?github=updated");
    expect(await row(github.id)).toMatchObject({ repository_selection: "selected" });
  });

  test("a tampered state links nothing and leaves the installation to claim", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    const state = await installState(cookie);
    const tampered = `${state.slice(0, -1)}${state.endsWith("A") ? "B" : "A"}`;

    expect(await setup(cookie, github.id, tampered)).toBe("/workspace?github=expired");

    expect(await row(github.id)).toMatchObject({ workspace_id: null });
    expect(await unclaimed(cookie)).toEqual([github.id]);
  });

  test("a state issued to someone else links nothing", async () => {
    const first = await owner();
    const second = await owner();
    const github = installation();
    visibleTo.set(second.githubToken, [github]);

    expect(await setup(second.cookie, github.id, await installState(first.cookie))).toBe(
      "/workspace?github=expired",
    );

    expect(await row(github.id)).toMatchObject({ workspace_id: null });
  });

  test("a revoked GitHub token asks the user to sign in again", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    revoked.add(githubToken);

    expect(await setup(cookie, github.id)).toBe("/workspace?github=reauth");

    for (const response of [
      await call("/github/installations/unclaimed", cookie),
      await claim(cookie, github.id),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "github_reauth" });
    }
  });

  test("setup explains requests, bad ids, and signed-out returns", async () => {
    const { cookie } = await owner();

    const requested = await call("/github/setup?setup_action=request", cookie);
    expect(requested.headers.get("location")).toBe("/workspace?github=requested");

    const invalid = await call("/github/setup?installation_id=nope", cookie);
    expect(invalid.headers.get("location")).toBe("/workspace?github=invalid");

    const signedOut = await app.request("/api/github/setup?installation_id=1", {}, env);
    expect(signedOut.headers.get("location")).toBe(
      `/login?redirect=${encodeURIComponent("/workspace?github=unclaimed")}`,
    );
  });
});

describe("installation webhooks (queue consumer)", () => {
  test("created records the installation, unclaimed", async () => {
    const github = installation();
    await webhook("installation", { action: "created", installation: github });
    expect(await row(github.id)).toEqual({
      workspace_id: null,
      account_login: github.account!.login,
      repository_selection: "all",
      suspended_at: null,
    });
  });

  test("suspend and unsuspend update status without touching the workspace link", async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    await webhook("installation", {
      action: "suspend",
      installation: { ...github, suspended_at: "2026-11-04T12:00:00Z" },
    });
    expect(await row(github.id)).toMatchObject({
      workspace_id: workspace.id,
      suspended_at: expect.any(Number),
    });
    expect(await listed(cookie)).toEqual([
      expect.objectContaining({ suspendedAt: "2026-11-04T12:00:00.000Z" }),
    ]);

    await webhook("installation", { action: "unsuspend", installation: github });
    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id, suspended_at: null });
  });

  test("an older delivery arriving late does not undo a newer one", async () => {
    const github = installation();
    const later = new Date(Date.now() + 60_000).toISOString();
    const earlier = new Date(Date.now() + 30_000).toISOString();
    await webhook("installation", { action: "created", installation: github }, earlier);
    // unsuspend was received after suspend, but the queue retried suspend and delivered it last.
    await webhook("installation", { action: "unsuspend", installation: github }, later);
    await webhook(
      "installation",
      { action: "suspend", installation: { ...github, suspended_at: "2026-11-04T12:00:00Z" } },
      earlier,
    );
    expect(await row(github.id)).toMatchObject({ suspended_at: null });
  });

  test("deleted removes the installation from the workspace", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    await webhook("installation", { action: "deleted", installation: github });

    expect(await row(github.id)).toBeNull();
    expect(await listed(cookie)).toEqual([]);
  });

  test("deleted from an ingress without the installation summary still removes the org", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    const message = toWebhookMessage("installation", crypto.randomUUID(), {
      action: "deleted",
      installation: github,
    });
    await processWebhook(env, { ...message!, installation: null } as NonNullable<typeof message>);

    expect(await row(github.id)).toBeNull();
  });

  test("a stale event after deleted stays out of the workspace and cannot be claimed", async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));
    await webhook("installation", { action: "deleted", installation: github });
    visibleTo.set(githubToken, []); // GitHub no longer lists it

    await webhook(
      "installation",
      { action: "suspend", installation: github },
      new Date(Date.now() - 60_000).toISOString(),
    );

    expect(await listed(cookie)).toEqual([]);
    expect(await unclaimed(cookie)).toEqual([]);
    expect((await claim(cookie, github.id)).status).toBe(404);
  });

  test("installation_repositories updates the repository selection", async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    await webhook("installation_repositories", {
      action: "removed",
      repository_selection: "selected",
      installation: github,
    });

    expect(await row(github.id)).toMatchObject({
      workspace_id: workspace.id,
      repository_selection: "selected",
    });
  });
});

describe("repository webhooks (queue consumer)", () => {
  let nextRepoId = 9000;

  function repo(
    owner: string,
    overrides: Partial<{ id: number; full_name: string; private: boolean }> = {},
  ) {
    nextRepoId += 1;
    return {
      id: nextRepoId,
      name: `repo-${nextRepoId}`,
      full_name: `${owner}/repo-${nextRepoId}`,
      private: true,
      ...overrides,
    };
  }

  // The repos stored for an installation, current ones first-class and removed ones flagged.
  async function repos(installationId: number) {
    const { results } = await env.DB.prepare(
      "select id, full_name, private, removed_at from github_repository where installation_id = ? order by id",
    )
      .bind(installationId)
      .all<{ id: number; full_name: string; private: number; removed_at: number | null }>();
    return results.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      private: row.private === 1,
      removed: row.removed_at !== null,
    }));
  }

  const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

  test("created saves every repo the installation can see, beyond one statement's worth", async () => {
    const github = installation();
    const list = Array.from({ length: 30 }, () => repo(github.account!.login));
    await webhook("installation", { action: "created", installation: github, repositories: list });
    expect(await repos(github.id)).toEqual(
      list.map((r) => ({ id: r.id, fullName: r.full_name, private: true, removed: false })),
    );
  });

  test("installation_repositories adds and removes repos", async () => {
    const github = installation();
    const [a, b, c] = [
      repo(github.account!.login),
      repo(github.account!.login),
      repo(github.account!.login, { private: false }),
    ];
    await webhook(
      "installation",
      {
        action: "created",
        installation: { ...github, repository_selection: "selected" },
        repositories: [a, b],
      },
      later(1),
    );
    await webhook(
      "installation_repositories",
      {
        action: "added",
        repository_selection: "selected",
        installation: github,
        repositories_added: [c],
        repositories_removed: [],
      },
      later(2),
    );
    await webhook(
      "installation_repositories",
      {
        action: "removed",
        repository_selection: "selected",
        installation: github,
        repositories_added: [],
        repositories_removed: [a],
      },
      later(3),
    );
    expect(await repos(github.id)).toEqual([
      { id: a.id, fullName: a.full_name, private: true, removed: true },
      { id: b.id, fullName: b.full_name, private: true, removed: false },
      { id: c.id, fullName: c.full_name, private: false, removed: false },
    ]);
  });

  test('a retried "added" that lands after a newer "removed" does not bring the repo back', async () => {
    const github = installation();
    const a = repo(github.account!.login);
    await webhook(
      "installation",
      { action: "created", installation: github, repositories: [] },
      later(1),
    );
    await webhook(
      "installation_repositories",
      {
        action: "removed",
        installation: github,
        repositories_added: [],
        repositories_removed: [a],
      },
      later(3),
    );
    await webhook(
      "installation_repositories",
      { action: "added", installation: github, repositories_added: [a], repositories_removed: [] },
      later(2),
    );
    // The removal leaves a tombstone even for a repo we never stored, so the stale add can't win.
    expect(await repos(github.id)).toEqual([
      { id: a.id, fullName: a.full_name, private: true, removed: true },
    ]);

    await webhook(
      "installation_repositories",
      { action: "added", installation: github, repositories_added: [a], repositories_removed: [] },
      later(4),
    );
    await webhook(
      "installation_repositories",
      {
        action: "removed",
        installation: github,
        repositories_added: [],
        repositories_removed: [a],
      },
      later(6),
    );
    await webhook(
      "installation_repositories",
      { action: "added", installation: github, repositories_added: [a], repositories_removed: [] },
      later(5),
    );
    expect(await repos(github.id)).toEqual([
      { id: a.id, fullName: a.full_name, private: true, removed: true },
    ]);
  });

  test("repository events add new repos and keep name and visibility current", async () => {
    const github = installation();
    const owner = github.account!.login;
    await webhook(
      "installation",
      { action: "created", installation: github, repositories: [] },
      later(1),
    );
    const a = repo(owner);

    await webhook(
      "repository",
      { action: "created", installation: { id: github.id }, repository: a },
      later(2),
    );
    await webhook(
      "repository",
      {
        action: "renamed",
        installation: { id: github.id },
        repository: { ...a, full_name: `${owner}/renamed` },
      },
      later(3),
    );
    await webhook(
      "repository",
      {
        action: "publicized",
        installation: { id: github.id },
        repository: { ...a, full_name: `${owner}/renamed`, private: false },
      },
      later(4),
    );
    // An older rename retried late changes nothing.
    await webhook(
      "repository",
      {
        action: "renamed",
        installation: { id: github.id },
        repository: { ...a, full_name: `${owner}/stale` },
      },
      later(3.5),
    );
    expect(await repos(github.id)).toEqual([
      { id: a.id, fullName: `${owner}/renamed`, private: false, removed: false },
    ]);

    await webhook(
      "repository",
      { action: "deleted", installation: { id: github.id }, repository: a },
      later(5),
    );
    expect(await repos(github.id)).toEqual([expect.objectContaining({ id: a.id, removed: true })]);
  });

  test("a repo transferred to another account is removed; one transferred in is added", async () => {
    const github = installation();
    const owner = github.account!.login;
    const out = repo(owner);
    await webhook(
      "installation",
      { action: "created", installation: github, repositories: [out] },
      later(1),
    );

    await webhook(
      "repository",
      {
        action: "transferred",
        installation: { id: github.id },
        repository: { ...out, full_name: "someone-else/moved" },
      },
      later(2),
    );
    const incoming = repo(owner);
    await webhook(
      "repository",
      { action: "transferred", installation: { id: github.id }, repository: incoming },
      later(3),
    );

    expect(await repos(github.id)).toEqual([
      expect.objectContaining({ id: out.id, removed: true }),
      { id: incoming.id, fullName: incoming.full_name, private: true, removed: false },
    ]);
  });

  test("a repo moving between two connected accounts ends up with the new one, whichever event lands first", async () => {
    const from = installation();
    const to = installation();
    const a = repo(from.account!.login);
    await webhook(
      "installation",
      { action: "created", installation: from, repositories: [a] },
      later(1),
    );
    await webhook(
      "installation",
      { action: "created", installation: to, repositories: [] },
      later(1),
    );
    const moved = { ...a, full_name: `${to.account!.login}/${a.name}` };

    await webhook(
      "repository",
      { action: "transferred", installation: { id: to.id }, repository: moved },
      later(2),
    );
    await webhook(
      "repository",
      { action: "transferred", installation: { id: from.id }, repository: moved },
      later(2),
    );

    expect(await repos(from.id)).toEqual([]);
    expect(await repos(to.id)).toEqual([
      { id: a.id, fullName: moved.full_name, private: true, removed: false },
    ]);
  });

  test("a repository event for an installation we have no row for is skipped", async () => {
    const a = repo("nobody");
    await webhook("repository", { action: "created", installation: { id: 424242 }, repository: a });
    const stored = await env.DB.prepare("select id from github_repository where id = ?")
      .bind(a.id)
      .first();
    expect(stored).toBeNull();
  });

  test("uninstalling removes the installation's repos", async () => {
    const github = installation();
    await webhook(
      "installation",
      { action: "created", installation: github, repositories: [repo(github.account!.login)] },
      later(1),
    );
    await webhook("installation", { action: "deleted", installation: github }, later(2));
    expect(await repos(github.id)).toEqual([]);
  });
});
