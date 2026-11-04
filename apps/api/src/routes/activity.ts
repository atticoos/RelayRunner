import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { listActivity } from "../jobs.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

// The Activity page: jobs RelayRunner routed for the active workspace's GitHub orgs, newest first.
// Page with ?before=<nextBefore from the previous page>.
export const activityRoutes = new Hono<AppEnv>().get(
  "/",
  requireUser,
  requireWorkspace,
  async (c) => {
    const raw = c.req.query("before");
    const before = raw === undefined ? undefined : Number(raw);
    if (before !== undefined && !Number.isSafeInteger(before))
      return c.json({ error: "invalid_cursor" }, 400);
    return c.json(await listActivity(c.var.db, c.var.workspace.id, before));
  },
);
