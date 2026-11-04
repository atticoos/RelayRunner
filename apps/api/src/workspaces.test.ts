import { readdirSync, readFileSync } from 'node:fs';
import { makeSignature } from 'better-auth/crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { app } from './app.ts';
import { createAuth } from './auth.ts';
import type { Env } from './env.ts';

// Runs the workspace flow against a real (in-memory, Miniflare) D1 with the committed migrations.
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: new URL('../wrangler.jsonc', import.meta.url).pathname, persist: false });
  env = {
    ...proxy.env,
    BETTER_AUTH_URL: 'http://localhost:8787',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret',
    GITHUB_APP_CLIENT_ID: 'id',
    GITHUB_APP_CLIENT_SECRET: 'secret',
  };
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of readFileSync(new URL(file, dir), 'utf8').split('--> statement-breakpoint')) {
      if (statement.trim()) await env.DB.prepare(statement).run();
    }
  }
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

let users = 0;
// What the dashboard does: create, then set it active so the cached session cookie picks it up
// (organization/create updates the session row but not the cookie cache).
async function createWorkspace(cookie: string, name: string, slug: string) {
  const created = await call('/auth/organization/create', cookie, { name, slug });
  expect(created.status).toBe(200);
  const workspace = (await created.json()) as { id: string; slug: string; members: { userId: string; role: string }[] };
  let jar = withSetCookies(cookie, created);
  const active = await call('/auth/organization/set-active', jar, { organizationId: workspace.id });
  expect(active.status).toBe(200);
  jar = withSetCookies(jar, active);
  return { workspace, cookie: jar };
}

async function signIn() {
  const ctx = await createAuth(env).$context;
  users += 1;
  const user = await ctx.internalAdapter.createUser({ name: `User ${users}`, email: `user${users}@example.com`, emailVerified: true }, { method: 'admin' });
  const session = await ctx.internalAdapter.createSession(user.id);
  const signed = `${session.token}.${await makeSignature(session.token, env.BETTER_AUTH_SECRET)}`;
  return { user, cookie: `better-auth.session_token=${encodeURIComponent(signed)}` };
}

function call(path: string, cookie: string, body?: unknown) {
  const init: RequestInit = body === undefined ? { headers: { cookie } } : { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: env.BETTER_AUTH_URL }, body: JSON.stringify(body) };
  return app.request(`/api${path}`, init, env);
}

// Keeps the cookies a response sets, like a browser would.
function withSetCookies(cookie: string, response: Response) {
  const jar = new Map(cookie.split('; ').map(pair => pair.split('=', 2) as [string, string]));
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

describe('workspaces', () => {
  test('a signed-out request is rejected', async () => {
    const response = await app.request('/api/workspaces/current', {}, env);
    expect(response.status).toBe(401);
  });

  test('a signed-in user without a workspace gets no_active_workspace', async () => {
    const { cookie } = await signIn();
    const response = await call('/workspaces/current', cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_active_workspace' });
  });

  test('a user creates a workspace, owns it, and it becomes active', async () => {
    const { user, cookie } = await signIn();
    const { workspace, cookie: jar } = await createWorkspace(cookie, 'Acme', 'acme');
    expect(workspace.slug).toBe('acme');
    expect(workspace.members).toEqual([expect.objectContaining({ userId: user.id, role: 'owner' })]);

    const current = await call('/workspaces/current', jar);
    expect(current.status).toBe(200);
    expect(await current.json()).toEqual({
      workspace: expect.objectContaining({ id: workspace.id, name: 'Acme', slug: 'acme' }),
      role: 'owner',
      installations: [],
    });

    const row = await env.DB.prepare('select workspace_id, user_id, role from workspace_member where workspace_id = ?').bind(workspace.id).first();
    expect(row).toEqual({ workspace_id: workspace.id, user_id: user.id, role: 'owner' });
  });

  test('a workspace lists only its own GitHub installations', async () => {
    const { cookie } = await signIn();
    const {
      workspace: { id },
      cookie: jar,
    } = await createWorkspace(cookie, 'Globex', 'globex');
    const now = Date.now();
    const insert = env.DB.prepare(
      'insert into github_installation (id, workspace_id, account_id, account_login, account_type, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    );
    await env.DB.batch([insert.bind(1, id, 10, 'globex', 'Organization', now, now), insert.bind(2, id, 11, 'globex-labs', 'Organization', now, now), insert.bind(3, null, 12, 'unclaimed', 'User', now, now)]);

    const current = await call('/workspaces/current', jar);
    const body = (await current.json()) as { installations: { accountLogin: string }[] };
    expect(body.installations.map(installation => installation.accountLogin)).toEqual(['globex', 'globex-labs']);
  });

  test('a workspace has one member for now', async () => {
    const { cookie } = await signIn();
    const {
      workspace: { id },
    } = await createWorkspace(cookie, 'Initech', 'initech');
    const other = await signIn();
    const added = await createAuth(env)
      .api.addMember({ body: { organizationId: id, userId: other.user.id, role: 'member' } })
      .then(
        () => 'added',
        (error: { body?: { code?: string } }) => error.body?.code,
      );
    expect(added).toBe('ORGANIZATION_MEMBERSHIP_LIMIT_REACHED');
  });

  test('a workspace slug is unique', async () => {
    const { cookie } = await signIn();
    const response = await call('/auth/organization/create', cookie, { name: 'Acme again', slug: 'acme' });
    expect(response.status).toBe(400);
  });
});
