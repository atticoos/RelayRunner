import { Hono } from "hono";
import type { AppEnv } from "../app.ts";
import { requireUser } from "../middleware/session.ts";
import { isOperator } from "../operators.ts";

export const meRoutes = new Hono<AppEnv>().get("/", requireUser, async (c) =>
  c.json({ user: c.var.user, operator: await isOperator(c.env, c.var.user!.id) }),
);
