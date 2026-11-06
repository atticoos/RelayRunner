import { eq } from "drizzle-orm";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";

/**
 * Whether a user is a RelayRunner operator: `user.role` is "operator". Operators see the
 * dashboard's Admin section. It only decides who sees the link: /admin and /api/admin stay behind
 * Cloudflare Access whoever the user is.
 */
export async function isOperator(env: Env, userId: string) {
  const [row] = await createDb(env.DB)
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return row?.role === "operator";
}
