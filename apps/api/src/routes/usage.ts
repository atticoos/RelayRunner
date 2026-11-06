import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { usageReport } from "../job-timings.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

const UsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

// The Usage page: how many of the workspace's jobs ran under a minute, and what GitHub's round-up
// to whole minutes cost, over the last ?days=N days (default 30).
export const usageRoutes = new Hono<AppEnv>().get("/", requireUser, requireWorkspace, async (c) => {
  const parsed = UsageQuery.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
  return c.json(await usageReport(c.var.db, c.var.workspace.id, parsed.data.days));
});
