import { and, eq, inArray } from "drizzle-orm";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";

/**
 * Whether a user is a RelayRunner operator: someone whose GitHub user ID is in
 * OPERATOR_GITHUB_IDS. Operators see the dashboard's Admin section. It only decides who sees the
 * link: /admin and /api/admin stay behind Cloudflare Access whoever the user is.
 */
export async function isOperator(env: Env, userId: string) {
  const ids = (env.OPERATOR_GITHUB_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) return false;
  const [row] = await createDb(env.DB)
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "github"),
        inArray(schema.account.accountId, ids),
      ),
    )
    .limit(1);
  return Boolean(row);
}
