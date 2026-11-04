import { Hono } from "hono";
import type { AppEnv } from "../app.ts";

// Better Auth serves its own routes (sign-in, callback, session, sign-out) under /api/auth/*.
export const authRoutes = new Hono<AppEnv>().on(["GET", "POST"], "/*", (c) =>
  c.var.auth.handler(c.req.raw),
);
