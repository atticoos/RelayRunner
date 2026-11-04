import { Hono } from "hono";
import type { AppEnv } from "../app.ts";

export const healthRoutes = new Hono<AppEnv>().get("/", (c) => c.json({ ok: true }));
