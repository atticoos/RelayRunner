import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { app } from './app.ts';
import type { Env } from './env.ts';
import { type GitHubInstallation, verifyInstallState } from './github.ts';
import * as testing from './testing.ts';

let proxy: Awaited<ReturnType<typeof testing.startD1>>['proxy'];
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
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://api.github.com/user/installations')) return realFetch(input, init);
    const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
    if (revoked.has(token)) return Promise.resolve(new Response('{}', { status: 401 }));
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
    account: { id: nextId + 5000, login: `org-${nextId}`, type: 'Organization' },
    repository_selection: 'all',
    suspended_at: null,
    ...overrides,
  };
}

let workspaces = 0;

// A signed-in owner of a fresh workspace.
async function owner() {
  const { user, githubToken, cookie } = await testing.signIn(env);
  workspaces += 1;
  const { workspace, cookie: jar } = await testing.createWorkspace(env, cookie, `Workspace ${workspaces}`, `github-test-${workspaces}`);
  return { user, githubToken, workspace, cookie: jar };
}

const call = (path: string, cookie: string, body?: unknown) => testing.call(env, path, cookie, body);

// The `state` the install link would carry for this user's active workspace.
async function installState(cookie: string) {
  const response = await call('/github/install', cookie);
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location')!).searchParams.get('state')!;
}

async function setup(cookie: string, installationId: number, state?: string) {
  const query = new URLSearchParams({ installation_id: String(installationId), setup_action: 'install' });
  if (state) query.set('state', state);
  const response = await call(`/github/setup?${query}`, cookie);
  expect(response.status).toBe(302);
  return response.headers.get('location');
}

async function listed(cookie: string) {
  const response = await call('/workspaces/current', cookie);
  return ((await response.json()) as { installations: Record<string, unknown>[] }).installations;
}

async function unclaimed(cookie: string) {
  const response = await call('/github/installations/unclaimed', cookie);
  expect(response.status).toBe(200);
  return ((await response.json()) as { installations: { id: number }[] }).installations.map(row => row.id);
}

const claim = (cookie: string, installationId: number) => call(`/github/installations/${installationId}/claim`, cookie, {});

async function sign(body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `sha256=${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function webhook(event: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const response = await app.request('/api/webhooks/github', { method: 'POST', body, headers: { 'x-github-event': event, 'x-hub-signature-256': await sign(body) } }, env);
  expect(response.status).toBe(202);
}

const row = (id: number) => env.DB.prepare('select workspace_id, account_login, repository_selection, suspended_at from github_installation where id = ?').bind(id).first();

describe('connecting a GitHub org', () => {
  test('/install redirects to the App install page with a state naming the workspace and user', async () => {
    const { user, workspace, cookie } = await owner();
    const response = await call('/github/install', cookie);
    expect(response.status).toBe(302);

    const location = new URL(response.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe('https://github.com/apps/relayrunner-test/installations/new');
    const state = await verifyInstallState(env.BETTER_AUTH_SECRET, location.searchParams.get('state')!);
    expect(state).toMatchObject({ workspaceId: workspace.id, userId: user.id });
  });

  test('/install needs a signed-in user', async () => {
    const response = await app.request('/api/github/install', {}, env);
    expect(response.status).toBe(401);
  });

  test('setup with a valid state links the installation to the workspace', async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation({ repository_selection: 'selected' });
    visibleTo.set(githubToken, [github]);

    expect(await setup(cookie, github.id, await installState(cookie))).toBe('/workspace?github=connected');

    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id });
    expect(await listed(cookie)).toEqual([
      {
        id: github.id,
        accountLogin: github.account!.login,
        accountType: 'Organization',
        repositorySelection: 'selected',
        suspendedAt: null,
        settingsUrl: `https://github.com/organizations/${github.account!.login}/settings/installations/${github.id}`,
      },
    ]);
  });

  test('a personal account links to the personal settings page', async () => {
    const { githubToken, cookie } = await owner();
    const github = installation({ account: { id: 77, login: 'octocat', type: 'User' } });
    visibleTo.set(githubToken, [github]);

    await setup(cookie, github.id, await installState(cookie));

    expect(await listed(cookie)).toEqual([expect.objectContaining({ accountType: 'User', settingsUrl: `https://github.com/settings/installations/${github.id}` })]);
  });

  test('an installation the token cannot see is not found and not linked', async () => {
    const { cookie } = await owner();
    const github = installation();

    expect(await setup(cookie, github.id, await installState(cookie))).toBe('/workspace?github=not_found');

    expect(await row(github.id)).toBeNull();
    expect(await listed(cookie)).toEqual([]);
    expect((await claim(cookie, github.id)).status).toBe(404);
  });

  test('an installation in another workspace is taken, through setup and through claim', async () => {
    const first = await owner();
    const second = await owner();
    const github = installation();
    visibleTo.set(first.githubToken, [github]);
    visibleTo.set(second.githubToken, [github]);
    await setup(first.cookie, github.id, await installState(first.cookie));

    expect(await setup(second.cookie, github.id, await installState(second.cookie))).toBe('/workspace?github=taken');
    expect(await setup(second.cookie, github.id)).toBe('/workspace?github=taken');

    const claimed = await claim(second.cookie, github.id);
    expect(claimed.status).toBe(409);
    expect(await claimed.json()).toEqual({ error: 'installation_in_another_workspace' });

    expect(await unclaimed(second.cookie)).toEqual([]);
    expect(await row(github.id)).toMatchObject({ workspace_id: first.workspace.id });
  });

  test('an install with no state stays unclaimed until the user claims it', async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);

    expect(await setup(cookie, github.id)).toBe('/workspace?github=unclaimed');
    expect(await row(github.id)).toMatchObject({ workspace_id: null });
    expect(await unclaimed(cookie)).toEqual([github.id]);

    const claimed = await claim(cookie, github.id);
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ ok: true });

    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id });
    expect(await unclaimed(cookie)).toEqual([]);
    expect(await listed(cookie)).toEqual([expect.objectContaining({ id: github.id })]);
  });

  test('unclaimed lists only what the token can see, and picks up installs the webhook missed', async () => {
    const { githubToken, cookie } = await owner();
    const mine = installation();
    const theirs = installation();
    visibleTo.set(githubToken, [mine]);
    await webhook('installation', { action: 'created', installation: theirs });

    expect(await unclaimed(cookie)).toEqual([mine.id]);
  });

  test('coming back after changing an installation on GitHub reads as updated', async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    visibleTo.set(githubToken, [{ ...github, repository_selection: 'selected' }]);

    expect(await setup(cookie, github.id)).toBe('/workspace?github=updated');
    expect(await row(github.id)).toMatchObject({ repository_selection: 'selected' });
  });

  test('a tampered state links nothing and leaves the installation to claim', async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    const state = await installState(cookie);
    const tampered = `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`;

    expect(await setup(cookie, github.id, tampered)).toBe('/workspace?github=expired');

    expect(await row(github.id)).toMatchObject({ workspace_id: null });
    expect(await unclaimed(cookie)).toEqual([github.id]);
  });

  test('a state issued to someone else links nothing', async () => {
    const first = await owner();
    const second = await owner();
    const github = installation();
    visibleTo.set(second.githubToken, [github]);

    expect(await setup(second.cookie, github.id, await installState(first.cookie))).toBe('/workspace?github=expired');

    expect(await row(github.id)).toMatchObject({ workspace_id: null });
  });

  test('a revoked GitHub token asks the user to sign in again', async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    revoked.add(githubToken);

    expect(await setup(cookie, github.id)).toBe('/workspace?github=reauth');

    for (const response of [await call('/github/installations/unclaimed', cookie), await claim(cookie, github.id)]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'github_reauth' });
    }
  });

  test('setup explains requests, bad ids, and signed-out returns', async () => {
    const { cookie } = await owner();

    const requested = await call('/github/setup?setup_action=request', cookie);
    expect(requested.headers.get('location')).toBe('/workspace?github=requested');

    const invalid = await call('/github/setup?installation_id=nope', cookie);
    expect(invalid.headers.get('location')).toBe('/workspace?github=invalid');

    const signedOut = await app.request('/api/github/setup?installation_id=1', {}, env);
    expect(signedOut.headers.get('location')).toBe(`/login?redirect=${encodeURIComponent('/workspace?github=unclaimed')}`);
  });
});

describe('installation webhooks', () => {
  test('created records the installation, unclaimed', async () => {
    const github = installation();
    await webhook('installation', { action: 'created', installation: github });
    expect(await row(github.id)).toEqual({ workspace_id: null, account_login: github.account!.login, repository_selection: 'all', suspended_at: null });
  });

  test('suspend and unsuspend update status without touching the workspace link', async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    await webhook('installation', { action: 'suspend', installation: { ...github, suspended_at: '2026-11-04T12:00:00Z' } });
    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id, suspended_at: expect.any(Number) });
    expect(await listed(cookie)).toEqual([expect.objectContaining({ suspendedAt: '2026-11-04T12:00:00.000Z' })]);

    await webhook('installation', { action: 'unsuspend', installation: github });
    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id, suspended_at: null });
  });

  test('deleted removes the installation from the workspace', async () => {
    const { githubToken, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    await webhook('installation', { action: 'deleted', installation: github });

    expect(await row(github.id)).toBeNull();
    expect(await listed(cookie)).toEqual([]);
  });

  test('installation_repositories updates the repository selection', async () => {
    const { githubToken, workspace, cookie } = await owner();
    const github = installation();
    visibleTo.set(githubToken, [github]);
    await setup(cookie, github.id, await installState(cookie));

    await webhook('installation_repositories', { action: 'removed', repository_selection: 'selected', installation: github });

    expect(await row(github.id)).toMatchObject({ workspace_id: workspace.id, repository_selection: 'selected' });
  });
});
