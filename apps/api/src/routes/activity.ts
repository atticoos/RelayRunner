import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { listActivity } from "../jobs.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

// `before` is a GitHub job id: the nextBefore of the previous page.
const ActivityQuery = z.object({
  before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

// The Activity page: jobs RelayRunner routed for the active workspace's GitHub orgs, newest first.
// Page with ?before=<nextBefore from the previous page>.
export const activityRoutes = new Hono<AppEnv>().get(
  "/",
  requireUser,
  requireWorkspace,
  async (c) => {
    const parsed = ActivityQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_cursor" }, 400);
    return c.json(await listActivity(c.var.db, c.var.workspace.id, parsed.data.before));
  },
);
