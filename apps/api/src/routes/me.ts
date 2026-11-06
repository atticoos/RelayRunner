import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { requireUser } from "../middleware/session.ts";

export const meRoutes = new Hono<AppEnv>().get("/", requireUser, (c) =>
  c.json({ user: c.var.user }),
);
