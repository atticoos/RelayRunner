import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Env } from "./env.ts";
import * as testing from "./testing.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;

beforeAll(async () => {
  ({ proxy, env } = await testing.startD1());
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

async function githubId(userId: string) {
  const row = await env.DB.prepare(
    "select account_id from account where user_id = ? and provider_id = 'github'",
  )
    .bind(userId)
    .first<{ account_id: string }>();
  return row!.account_id;
}

describe("GET /api/me operator", () => {
  test("is true only for a user whose GitHub ID is in OPERATOR_GITHUB_IDS", async () => {
    const operator = await testing.signIn(env);
    const other = await testing.signIn(env);
    const withOperators = {
      ...env,
      OPERATOR_GITHUB_IDS: ` 1, ${await githubId(operator.user.id)} `,
    };

    const me = async (cookie: string, target: Env) =>
      ((await (await testing.call(target, "/me", cookie)).json()) as { operator: boolean })
        .operator;

    expect(await me(operator.cookie, withOperators)).toBe(true);
    expect(await me(other.cookie, withOperators)).toBe(false);
    expect(await me(operator.cookie, { ...env, OPERATOR_GITHUB_IDS: undefined })).toBe(false);
  });
});
