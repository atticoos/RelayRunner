import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../app.ts';
import { schema } from '../db/index.ts';
import { requireUser } from '../middleware/session.ts';
import { requireWorkspace } from '../middleware/workspace.ts';

// Creating, listing and switching workspaces goes through Better Auth's organization endpoints
// (/api/auth/organization/*). This adds the gateway's view of the active workspace.
export const workspaceRoutes = new Hono<AppEnv>().get('/current', requireUser, requireWorkspace, async c => {
  const { workspace, role, db } = c.var;
  const installations = await db
    .select({
      id: schema.githubInstallation.id,
      accountLogin: schema.githubInstallation.accountLogin,
      accountType: schema.githubInstallation.accountType,
      suspendedAt: schema.githubInstallation.suspendedAt,
    })
    .from(schema.githubInstallation)
    .where(eq(schema.githubInstallation.workspaceId, workspace.id))
    .orderBy(asc(schema.githubInstallation.accountLogin));
  return c.json({ workspace, role, installations });
});
