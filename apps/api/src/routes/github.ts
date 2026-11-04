import { and, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../app.ts";
import { createDb, schema } from "../db/index.ts";
import {
  GitHubError,
  installUrl,
  installationSettingsUrl,
  listUserInstallations,
  signInstallState,
  verifyInstallState,
} from "../github.ts";
import {
  findInstallation,
  isWorkspaceMember,
  linkInstallation,
  upsertInstallation,
  userGitHubToken,
} from "../installations.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

// Connecting GitHub orgs (GitHub App installations) to workspaces.
//
// 1. The dashboard's "Connect GitHub org" links to GET /install, which sends the user to the App's
//    install page with a signed `state` naming the active workspace.
// 2. GitHub sends them back to the App's Setup URL, GET /setup, with `installation_id`. That id
//    comes from a query string, so it only counts if the user's own GitHub token can see it in
//    GET /user/installations. Then the installation is linked to the workspace from `state`.
// 3. Installs made straight on GitHub arrive with no `state` (or by webhook only) and stay
//    unclaimed. The dashboard lists the user's unclaimed ones (GET /installations/unclaimed) and
//    claims one into the active workspace (POST /installations/:id/claim), with the same check.
//
// An installation belongs to at most one workspace; linking one that another workspace holds is
// refused.

// Where /setup sends the browser, with ?github=<outcome> for the dashboard to explain.
type SetupOutcome =
  | "connected"
  | "updated"
  | "unclaimed"
  | "requested"
  | "taken"
  | "not_found"
  | "expired"
  | "reauth"
  | "invalid";

const MANAGER_ROLES = new Set(["owner", "admin"]);

export const githubRoutes = new Hono<AppEnv>()
  .get("/install", requireUser, requireWorkspace, async (c) => {
    if (!MANAGER_ROLES.has(c.var.role)) return c.json({ error: "forbidden" }, 403);
    if (!c.env.GITHUB_APP_SLUG) return c.json({ error: "github_app_slug_not_configured" }, 500);
    const state = await signInstallState(
      c.env.BETTER_AUTH_SECRET,
      c.var.workspace.id,
      c.var.user!.id,
    );
    return c.redirect(installUrl(c.env.GITHUB_APP_SLUG, state));
  })

  .get("/setup", async (c) => {
    const done = (outcome: SetupOutcome) => c.redirect(`/workspace?github=${outcome}`);
    // An org member without admin asked an owner to approve the install. Nothing to link yet; the
    // installation webhook records it once approved.
    if (c.req.query("setup_action") === "request") return done("requested");

    const user = c.var.user;
    // Signed out (or the session expired on the way): the installation is recorded by webhook and
    // shows up to claim after sign-in.
    if (!user)
      return c.redirect(`/login?redirect=${encodeURIComponent("/workspace?github=unclaimed")}`);

    const installationId = Number(c.req.query("installation_id"));
    if (!Number.isSafeInteger(installationId) || installationId <= 0) return done("invalid");

    const db = createDb(c.env.DB);
    const verified = await verifiedInstallation(c, installationId);
    if (verified === "reauth") return done("reauth");
    if (!verified) return done("not_found");
    await upsertInstallation(db, verified);

    const stateParam = c.req.query("state");
    if (stateParam) {
      const state = await verifyInstallState(c.env.BETTER_AUTH_SECRET, stateParam);
      // A stale or someone else's link: keep the installation, unclaimed, for the user to claim.
      if (!state || state.userId !== user.id) return done("expired");
      const membership = await isWorkspaceMember(db, state.workspaceId, user.id);
      if (!membership || !MANAGER_ROLES.has(membership.role)) return done("expired");
      const result = await linkInstallation(db, installationId, state.workspaceId);
      return done(result === "taken" ? "taken" : "connected");
    }

    // No state: installed straight from GitHub, or "Redirect on update" after changing the
    // installation's repos or permissions.
    const row = await findInstallation(db, installationId);
    if (!row?.workspaceId) return done("unclaimed");
    return done((await isWorkspaceMember(db, row.workspaceId, user.id)) ? "updated" : "taken");
  })

  .get("/installations/unclaimed", requireUser, async (c) => {
    const db = createDb(c.env.DB);
    const token = await userGitHubToken(c.var.auth, db, c.var.user!.id);
    if (!token) return c.json({ error: "github_reauth" }, 409);
    const visible = await listOrReauth(token);
    if (visible === "reauth") return c.json({ error: "github_reauth" }, 409);
    // Catch up on installs whose webhook we missed (or that predate the webhook handler).
    for (const installation of visible) await upsertInstallation(db, installation);
    if (!visible.length) return c.json({ installations: [] });

    const rows = await db
      .select()
      .from(schema.githubInstallation)
      .where(
        and(
          inArray(
            schema.githubInstallation.id,
            visible.map((installation) => installation.id),
          ),
          isNull(schema.githubInstallation.workspaceId),
        ),
      )
      .orderBy(schema.githubInstallation.accountLogin);
    return c.json({ installations: rows.map(present) });
  })

  .post("/installations/:id/claim", requireUser, requireWorkspace, async (c) => {
    if (!MANAGER_ROLES.has(c.var.role)) return c.json({ error: "forbidden" }, 403);
    const installationId = Number(c.req.param("id"));
    if (!Number.isSafeInteger(installationId) || installationId <= 0)
      return c.json({ error: "not_found" }, 404);

    const verified = await verifiedInstallation(c, installationId);
    if (verified === "reauth") return c.json({ error: "github_reauth" }, 409);
    if (!verified) return c.json({ error: "not_found" }, 404);
    await upsertInstallation(c.var.db, verified);

    if ((await linkInstallation(c.var.db, installationId, c.var.workspace.id)) === "taken") {
      return c.json({ error: "installation_in_another_workspace" }, 409);
    }
    return c.json({ ok: true });
  });

// The installation as GitHub shows it to this user, null if their token can't see it, or 'reauth'
// if we have no usable token.
async function verifiedInstallation(c: Context<AppEnv>, installationId: number) {
  const token = await userGitHubToken(c.var.auth, createDb(c.env.DB), c.var.user!.id);
  if (!token) return "reauth" as const;
  const visible = await listOrReauth(token);
  if (visible === "reauth") return visible;
  return visible.find((installation) => installation.id === installationId) ?? null;
}

async function listOrReauth(token: string) {
  try {
    return await listUserInstallations(token);
  } catch (error) {
    // A revoked or expired token. Anything else (GitHub down) should surface as a 500.
    if (error instanceof GitHubError && error.status === 401) return "reauth" as const;
    throw error;
  }
}

export function present(row: typeof schema.githubInstallation.$inferSelect) {
  return {
    id: row.id,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    suspendedAt: row.suspendedAt,
    settingsUrl: installationSettingsUrl(row),
  };
}
