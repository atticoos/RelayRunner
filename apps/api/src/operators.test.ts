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

const operatorFlag = async (cookie: string) =>
  ((await (await testing.call(env, "/me", cookie)).json()) as { operator: boolean }).operator;

describe("GET /api/me operator", () => {
  test("is true only for a user whose role is operator", async () => {
    const operator = await testing.signIn(env);
    const other = await testing.signIn(env);
    await env.DB.prepare("update user set role = 'operator' where id = ?")
      .bind(operator.user.id)
      .run();

    expect(await operatorFlag(operator.cookie)).toBe(true);
    expect(await operatorFlag(other.cookie)).toBe(false);
  });
});
