import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { createDb, schema } from './db/index.ts';
import type { Env } from './env.ts';

// Workers only expose bindings per request, so build the auth instance per request too. It is
// cheap: no I/O happens until a handler runs.
export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(createDb(env.DB), { provider: 'sqlite', schema }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_APP_CLIENT_ID,
        clientSecret: env.GITHUB_APP_CLIENT_SECRET,
      },
    },
    session: {
      // Keep a signed copy of the session in a cookie so most getSession calls skip D1.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    plugins: [
      workspaces(),
      // Next: deviceAuthorization() for `relayrunner login` and bearer() for per-machine
      // credentials, both from better-auth/plugins. Each adds tables, so regenerate migrations.
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth['$Infer']['Session'];

// Workspaces are Better Auth organizations, stored under gateway names (workspace,
// workspace_member, workspace_invitation, session.active_workspace_id). The dashboard uses the
// stock organization client at /api/auth/organization/*.
export function workspaces() {
  return organization({
    // Any signed-in user can create a workspace and becomes its owner.
    allowUserToCreateOrganization: true,
    creatorRole: 'owner',
    // MVP: one owner per workspace, no invites yet. The member and invitation tables are shaped
    // for teams; raise this (and add sendInvitationEmail) when teams land.
    membershipLimit: 1,
    schema: {
      organization: { modelName: 'workspace' },
      member: { modelName: 'workspaceMember', fields: { organizationId: 'workspaceId' } },
      invitation: { modelName: 'workspaceInvitation', fields: { organizationId: 'workspaceId' } },
      session: { fields: { activeOrganizationId: 'activeWorkspaceId' } },
    },
  });
}
