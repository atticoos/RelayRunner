import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { freeCheckSavings } from "../free-checks.ts";
import { usageReport } from "../job-timings.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

const UsageQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

// The Usage page: how many of the workspace's jobs ran under a minute, what GitHub's round-up to
// whole minutes cost, and what the free checks saved, over the last ?days=N days (default 30).
// /checks is the free checks alone, for the Activity page.
export const usageRoutes = new Hono<AppEnv>()
  .get("/", requireUser, requireWorkspace, async (c) => {
    const parsed = UsageQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    const { db, workspace } = c.var;
    const [report, freeChecks] = await Promise.all([
      usageReport(db, workspace.id, parsed.data.days),
      freeCheckSavings(db, workspace.id, parsed.data.days),
    ]);
    return c.json({ ...report, freeChecks });
  })
  .get("/checks", requireUser, requireWorkspace, async (c) => {
    const parsed = UsageQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_query" }, 400);
    return c.json(await freeCheckSavings(c.var.db, c.var.workspace.id, parsed.data.days));
  });
