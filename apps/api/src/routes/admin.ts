/**
 * Operator admin over D1: every user and workspace, and who is an operator. Needs Cloudflare Access
 * and an operator session (middleware/admin.ts). Grant the first operator with SQL
 * (docs/cloudflare-access.md); after that, operators grant each other here.
 */
import { count, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { createDb, schema } from "../db/index.ts";
import { requireAccess, requireOperator, who } from "../middleware/admin.ts";

// Global user roles. Null is a regular user.
export const USER_ROLES = ["operator"] as const;

const RoleBody = z.object({ role: z.enum(USER_ROLES).nullable() });

export const adminRoutes = new Hono<AppEnv>()
  .use("*", requireAccess, requireOperator)
  .get("/users", async (c) => {
    const db = createDb(c.env.DB);
    const users = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        role: schema.user.role,
        createdAt: schema.user.createdAt,
        workspaces: count(schema.workspaceMember.id),
      })
      .from(schema.user)
      .leftJoin(schema.workspaceMember, eq(schema.workspaceMember.userId, schema.user.id))
      .groupBy(schema.user.id)
      .orderBy(desc(schema.user.createdAt));
    return c.json({ users });
  })
  .patch("/users/:id", async (c) => {
    const parsed = RoleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_role" }, 400);
    const id = c.req.param("id");
    // Keeps at least the caller an operator, so nobody locks the last one out by accident.
    if (id === c.var.user!.id && parsed.data.role !== "operator") {
      return c.json({ error: "cannot_demote_self" }, 400);
    }
    const [updated] = await createDb(c.env.DB)
      .update(schema.user)
      .set({ role: parsed.data.role })
      .where(eq(schema.user.id, id))
      .returning({ id: schema.user.id, role: schema.user.role });
    if (!updated) return c.json({ error: "not_found" }, 404);
    console.log(
      JSON.stringify({
        msg: "user role changed",
        by: c.var.user!.email,
        access: who(c.var.accessIdentity),
        userId: id,
        role: updated.role,
      }),
    );
    return c.json({ user: updated });
  })
  .get("/workspaces", async (c) => {
    const db = createDb(c.env.DB);
    const [workspaces, members, installations] = await Promise.all([
      db.select().from(schema.workspace).orderBy(desc(schema.workspace.createdAt)),
      db
        .select({
          workspaceId: schema.workspaceMember.workspaceId,
          userId: schema.user.id,
          name: schema.user.name,
          email: schema.user.email,
          role: schema.workspaceMember.role,
        })
        .from(schema.workspaceMember)
        .innerJoin(schema.user, eq(schema.user.id, schema.workspaceMember.userId)),
      db
        .select({
          workspaceId: schema.githubInstallation.workspaceId,
          accountLogin: schema.githubInstallation.accountLogin,
        })
        .from(schema.githubInstallation)
        .where(isNotNull(schema.githubInstallation.workspaceId)),
    ]);
    const membersOf = Map.groupBy(members, (member) => member.workspaceId);
    const accountsOf = Map.groupBy(installations, (installation) => installation.workspaceId);
    return c.json({
      workspaces: workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        createdAt: workspace.createdAt,
        members: membersOf.get(workspace.id) ?? [],
        githubAccounts: (accountsOf.get(workspace.id) ?? []).map((i) => i.accountLogin),
      })),
    });
  });
