import { readRunnerOrder, runnerOrderSchema } from "@relayrunner/runner-order";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";
import { createDb, schema } from "../db/index.ts";
import { isWorkspaceMember } from "../installations.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";
import { present } from "./github.ts";

// Any member of the workspace in the path. Someone outside it gets a 404, so ids don't leak.
const requireMember = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  const membership = await isWorkspaceMember(db, c.req.param("id") ?? "", c.var.user!.id);
  if (!membership) return c.json({ error: "not_found" }, 404);
  c.set("db", db);
  c.set("role", membership.role);
  await next();
});

// Creating, listing and switching workspaces goes through Better Auth's organization endpoints
// (/api/auth/organization/*). This adds the gateway's view of the active workspace.
export const workspaceRoutes = new Hono<AppEnv>()
  .get("/current", requireUser, requireWorkspace, async (c) => {
    const { workspace, role, db } = c.var;
    const installations = await db
      .select()
      .from(schema.githubInstallation)
      .where(eq(schema.githubInstallation.workspaceId, workspace.id))
      .orderBy(asc(schema.githubInstallation.accountLogin));
    const { runnerOrder: _, ...rest } = workspace;
    return c.json({ workspace: rest, role, installations: installations.map(present) });
  })
  // The workspace's runner order (#110). Routing reads it from #113 on.
  .get("/:id/runner-order", requireUser, requireMember, async (c) => {
    const [row] = await c.var.db
      .select({ runnerOrder: schema.workspace.runnerOrder })
      .from(schema.workspace)
      .where(eq(schema.workspace.id, c.req.param("id")))
      .limit(1);
    return c.json({ order: readRunnerOrder(row?.runnerOrder), isDefault: !row?.runnerOrder });
  })
  .put("/:id/runner-order", requireUser, requireMember, async (c) => {
    const parsed = runnerOrderSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const issues = parsed.error.issues.map(({ path, message }) => ({ path, message }));
      return c.json({ error: "invalid_runner_order", issues }, 400);
    }
    await c.var.db
      .update(schema.workspace)
      .set({ runnerOrder: JSON.stringify(parsed.data) })
      .where(eq(schema.workspace.id, c.req.param("id")));
    return c.json({ order: parsed.data, isDefault: false });
  });
