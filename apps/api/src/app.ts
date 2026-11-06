import { Hono } from "hono";
import type { Auth, Session } from "./auth.ts";
import type { Db, schema } from "./db/index.ts";
import type { Env } from "./env.ts";
import { attachSession } from "./middleware/session.ts";
import { activityRoutes } from "./routes/activity.ts";
import { authRoutes } from "./routes/auth.ts";
import { devWebhookRoutes } from "./routes/dev-webhooks.ts";
import { githubRoutes } from "./routes/github.ts";
import { healthRoutes } from "./routes/health.ts";
import { inviteRoutes } from "./routes/invites.ts";
import { machineRoutes } from "./routes/machines.ts";
import { meRoutes } from "./routes/me.ts";
import { usageRoutes } from "./routes/usage.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";

export interface AppEnv {
  Bindings: Env;
  Variables: {
    auth: Auth;
    user: Session["user"] | null;
    session: Session["session"] | null;
    // Set by requireWorkspace.
    db: Db;
    workspace: typeof schema.workspace.$inferSelect;
    role: string;
  };
}

// Everything lives under /api so the dashboard can call it same-origin.
export const app = new Hono<AppEnv>().basePath("/api");

// Public routes. These never touch auth or D1.
app.route("/health", healthRoutes);
// Development-only, behind Cloudflare Access: each route checks the Access JWT itself
// (docs/cloudflare-access.md). Needs no session or D1, so it works while D1 is down.
app.route("/dev/webhooks", devWebhookRoutes);

// Everything below sees c.var.auth, c.var.user and c.var.session.
app.use("*", attachSession);
app.route("/auth", authRoutes);
app.route("/me", meRoutes);
app.route("/workspaces", workspaceRoutes);
app.route("/invites", inviteRoutes);
app.route("/activity", activityRoutes);
app.route("/usage", usageRoutes);
app.route("/github", githubRoutes);
app.route("/machines", machineRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
