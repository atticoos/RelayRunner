import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app.ts";
import { schema } from "../db/index.ts";
import {
  appJwt,
  DEFAULT_RUNNER_GROUP_ID,
  generateOrgJitConfig,
  importAppPrivateKey,
  installationToken,
} from "../github-app.ts";
import { requireUser } from "../middleware/session.ts";
import { requireWorkspace } from "../middleware/workspace.ts";

// The label a debug JIT runner registers with. A `runs-on: rr-test` job in a connected org runs
// on whichever machine was handed the config.
export const DEBUG_RUNNER_LABEL = "rr-test";

const JitConfigRequest = z.object({ org: z.string().min(1) });

// Hand-fed jobs for testing machines before the gateway routes to them (#63). Remove once
// routing (#67) can send a machine real work.
export const debugRoutes = new Hono<AppEnv>()
  // Mints a one-job org runner on the `rr-test` label and returns its encoded config, for
  // `relayrunner debug run-job --jitconfig -`. Workspace owners only, and only for an org whose
  // installation this workspace holds.
  .post("/jit-config", requireUser, requireWorkspace, async (c) => {
    if (c.var.role !== "owner") return c.json({ error: "forbidden" }, 403);
    const body = JitConfigRequest.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_request" }, 400);

    const installations = await c.var.db
      .select()
      .from(schema.githubInstallation)
      .where(
        and(
          eq(schema.githubInstallation.workspaceId, c.var.workspace.id),
          eq(schema.githubInstallation.accountType, "Organization"),
        ),
      );
    const installation = installations.find(
      (row) => row.accountLogin.toLowerCase() === body.data.org.toLowerCase(),
    );
    if (!installation) return c.json({ error: "org_not_connected" }, 404);

    const key = await importAppPrivateKey(await c.env.GITHUB_APP_PRIVATE_KEY.get());
    const token = await installationToken(await appJwt(c.env.GITHUB_APP_ID, key), installation.id);
    const jit = await generateOrgJitConfig(token, installation.accountLogin, {
      name: `relayrunner-debug-${crypto.randomUUID().slice(0, 8)}`,
      labels: [DEBUG_RUNNER_LABEL],
      runnerGroupId: DEFAULT_RUNNER_GROUP_ID,
    });
    console.log(
      JSON.stringify({
        message: "relayrunner debug jit config",
        org: installation.accountLogin,
        runnerId: jit.runnerId,
        userId: c.var.user!.id,
      }),
    );
    return c.json({
      org: installation.accountLogin,
      label: DEBUG_RUNNER_LABEL,
      runnerId: jit.runnerId,
      jitConfig: jit.encodedJitConfig,
    });
  });
