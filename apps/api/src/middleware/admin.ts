import { gateAdmin, type AccessIdentity } from "@relayrunner/access";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../app.ts";

// Operator admin routes (/api/admin/*) sit behind Cloudflare Access (docs/cloudflare-access.md).
// This Worker's own workers.dev URL is public, so each route checks the Access JWT itself and
// never trusts the dashboard Worker to have done it. Sets c.var.accessIdentity.
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const gate = await gateAdmin(c.req.raw, c.env);
  if ("response" in gate) return gate.response;
  c.set("accessIdentity", gate.identity);
  await next();
});

// The signed-in user is an operator (user.role). Admin routes that read or change D1 data need
// this as well as Access, so an Access service token alone can't change who is an operator.
export const requireOperator = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) return c.json({ error: "unauthorized" }, 401);
  if (c.var.user.role !== "operator") return c.json({ error: "forbidden" }, 403);
  await next();
});

// Who did it, for audit logs: a person's email or a service token's Client ID.
export function who(identity: AccessIdentity) {
  return identity.kind === "user" ? identity.email : identity.clientId;
}
