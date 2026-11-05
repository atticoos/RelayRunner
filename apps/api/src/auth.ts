import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, oAuthProxy, organization } from "better-auth/plugins";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";

// Preview dashboards (Workers Builds `wrangler preview`) reach this Worker through their own API
// service binding, so requests arrive with the preview host. PREVIEW_ORIGINS lists their origin
// patterns, comma-separated, e.g. https://*-relayrunner-app.relayrun.workers.dev.
export function previewOrigins(env: Pick<Env, "PREVIEW_ORIGINS">) {
  return (env.PREVIEW_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// The client_id `relayrunner connect` sends with its device code requests.
export const MACHINE_CLIENT_ID = "relayrunner-cli";

// Workers only expose bindings per request, so build the auth instance per request too. It is
// cheap: no I/O happens until a handler runs.
export function createAuth(env: Env) {
  return betterAuth({
    // Always the production dashboard origin, so GitHub only ever sees one OAuth callback URL.
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    // Lets preview origins call /api/auth/* (origin check) and be redirect targets.
    trustedOrigins: previewOrigins(env),
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite", schema }),
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
      // Sign-in from a preview: GitHub returns to the production callback, which exchanges the
      // code and redirects to <preview>/api/auth/callback/github/oauth-proxy with the profile
      // encrypted (BETTER_AUTH_SECRET). The preview then creates the session and sets its own
      // host-only cookie. On production itself the plugin steps aside.
      oAuthProxy({
        productionURL: env.BETTER_AUTH_URL,
        // Seconds the encrypted hand-off stays valid; it only has to survive one redirect.
        maxAge: 60,
      }),
      // `relayrunner connect` signs in with a device code the user approves at /device in the
      // dashboard (src/machines.ts). The CLI only holds the resulting user session long enough to
      // trade it for a machine token at POST /api/machines/claim.
      deviceAuthorization({
        verificationUri: new URL("/device", env.BETTER_AUTH_URL).toString(),
        validateClient: (clientId) => clientId === MACHINE_CLIENT_ID,
        expiresIn: "30m",
        interval: "5s",
      }),
      // Lets that claim call send the device-flow session as `Authorization: Bearer <token>`.
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];

// Workspaces are Better Auth organizations, stored under gateway names (workspace,
// workspace_member, workspace_invitation, session.active_workspace_id). The dashboard uses the
// stock organization client at /api/auth/organization/*.
export function workspaces() {
  return organization({
    // Any signed-in user can create a workspace and becomes its owner.
    allowUserToCreateOrganization: true,
    creatorRole: "owner",
    // MVP: one owner per workspace, no invites yet. The member and invitation tables are shaped
    // for teams; raise this (and add sendInvitationEmail) when teams land.
    membershipLimit: 1,
    schema: {
      organization: { modelName: "workspace" },
      member: { modelName: "workspaceMember", fields: { organizationId: "workspaceId" } },
      invitation: { modelName: "workspaceInvitation", fields: { organizationId: "workspaceId" } },
      session: { fields: { activeOrganizationId: "activeWorkspaceId" } },
    },
  });
}
