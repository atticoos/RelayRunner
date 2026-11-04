import type { WebhookMessage, WorkflowJob } from "@relayrunner/github-webhooks";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createDb, schema } from "./db/index.ts";
import type { Env } from "./env.ts";
import type { ActivityJob } from "./jobs.ts";
import * as testing from "./testing.ts";
import { processWebhook } from "./webhook-queue.ts";

let proxy: Awaited<ReturnType<typeof testing.startD1>>["proxy"];
let env: Env;
const start = vi.fn();
// The Router and MachineLink Durable Objects, reduced to what a route job's webhooks call.
const claim = vi.fn();
const machineFor = vi.fn();
const run = vi.fn(async () => "sent");

beforeAll(async () => {
  let d1Env: Env;
  ({ proxy, env: d1Env } = await testing.startD1());
  env = {
    ...d1Env,
    PICK_RUNNER: { getByName: () => ({ start }) },
    ROUTER: { getByName: () => ({ claim, machineFor }) },
    MACHINE_LINK: { getByName: () => ({ run }) },
  } as unknown as Env;
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

let ids = 0;

// A signed-in owner of a fresh workspace with one connected installation.
async function connectedWorkspace() {
  ids += 1;
  const { cookie: signedIn } = await testing.signIn(env);
  const { workspace, cookie } = await testing.createWorkspace(
    env,
    signedIn,
    `Jobs ${ids}`,
    `jobs-${ids}`,
  );
  const installationId = 900 + ids;
  await createDb(env.DB)
    .insert(schema.githubInstallation)
    .values({
      id: installationId,
      workspaceId: workspace.id,
      accountId: installationId,
      accountLogin: `org-${ids}`,
      accountType: "Organization",
    });
  return { cookie, installationId, workspaceId: workspace.id, runId: 7000 + ids * 10 };
}

function jobEvent(
  installationId: number,
  job: Partial<WorkflowJob> & Pick<WorkflowJob, "id" | "runId" | "name" | "labels">,
  action = "queued",
): WebhookMessage {
  return {
    event: "workflow_job",
    deliveryId: `d-${job.id}-${action}`,
    action,
    installationId,
    receivedAt: new Date().toISOString(),
    repository: { id: 55, fullName: "relayrunner/relayrunner-ci-tests" },
    job: {
      runAttempt: 1,
      workflowName: "RelayRunner dev",
      status: action,
      conclusion: null,
      headBranch: "main",
      headSha: "abc123",
      runnerName: null,
      createdAt: "2026-11-04T18:00:00Z",
      ...job,
    },
  };
}

async function activity(cookie: string, query = "") {
  const res = await testing.call(env, `/activity${query}`, cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as { jobs: ActivityJob[]; nextBefore: number | null };
}

describe("Activity", () => {
  test("lists the job a pick routed, with the runner it selected", async () => {
    const { cookie, installationId, runId } = await connectedWorkspace();
    const pick = { id: runId + 1, runId, name: "pick", labels: ["relayrunner"] };
    const test = { id: runId + 2, runId, name: "test", labels: ["ubuntu-latest"] };

    await processWebhook(env, jobEvent(installationId, pick));
    // The pick job itself isn't activity.
    expect((await activity(cookie)).jobs).toEqual([]);

    await processWebhook(
      env,
      jobEvent(installationId, { ...pick, runnerName: "relayrunner-pick-1" }, "in_progress"),
    );
    await processWebhook(
      env,
      jobEvent(installationId, { ...pick, conclusion: "success" }, "completed"),
    );
    await processWebhook(env, jobEvent(installationId, test));
    await processWebhook(
      env,
      jobEvent(
        installationId,
        { ...test, runnerName: "GitHub Actions 3", startedAt: "2026-11-04T18:01:00Z" },
        "in_progress",
      ),
    );

    const { jobs } = await activity(cookie);
    expect(jobs).toMatchObject([
      {
        id: test.id,
        workflow: "RelayRunner dev",
        name: "test",
        runner: { type: "github", label: "ubuntu-latest" },
        runnerName: "GitHub Actions 3",
        status: "in_progress",
        repository: "relayrunner/relayrunner-ci-tests",
        startedAt: "2026-11-04T18:01:00.000Z",
        url: `https://github.com/relayrunner/relayrunner-ci-tests/actions/runs/${runId}/job/${test.id}`,
      },
    ]);
  });

  test("names the machine a route sent the job to, never the rr- label", async () => {
    const { cookie, installationId, workspaceId, runId } = await connectedWorkspace();
    const machineId = `machine-${runId}`;
    await createDb(env.DB)
      .insert(schema.machine)
      .values({ id: machineId, workspaceId, name: "Atticus's MacBook" });
    await processWebhook(
      env,
      jobEvent(installationId, { id: runId + 1, runId, name: "pick", labels: ["relayrunner"] }),
    );
    const test = { id: runId + 2, runId, name: "test", labels: ["rr-0123456789ab"] };

    // Before the route is claimed, the job is known to be a machine's, but not which one.
    claim.mockResolvedValueOnce(null);
    await processWebhook(env, jobEvent(installationId, test));
    expect((await activity(cookie)).jobs[0].runner).toEqual({
      type: "machine",
      machineId: null,
      name: null,
    });

    // A redelivered `queued` claims the route and hands it to the machine.
    claim.mockResolvedValueOnce({ id: "0123456789ab", machineId });
    await processWebhook(env, jobEvent(installationId, test));
    expect(claim).toHaveBeenLastCalledWith("0123456789ab", {
      jobId: test.id,
      repositoryId: 55,
      runId,
    });
    expect((await activity(cookie)).jobs[0].runner).toEqual({
      type: "machine",
      machineId,
      name: "Atticus's MacBook",
    });
  });

  test("learns a route job's machine from a webhook that beats its `queued`", async () => {
    const { cookie, installationId, workspaceId, runId } = await connectedWorkspace();
    const machineId = `machine-${runId}`;
    await createDb(env.DB)
      .insert(schema.machine)
      .values({ id: machineId, workspaceId, name: "studio" });
    await processWebhook(
      env,
      jobEvent(installationId, { id: runId + 1, runId, name: "pick", labels: ["relayrunner"] }),
    );
    machineFor.mockResolvedValueOnce(machineId);
    await processWebhook(
      env,
      jobEvent(
        installationId,
        {
          id: runId + 2,
          runId,
          name: "test",
          labels: ["rr-0123456789ab"],
          runnerName: "studio-0123456789ab",
        },
        "in_progress",
      ),
    );
    const [job] = (await activity(cookie)).jobs;
    expect(job).toMatchObject({
      status: "in_progress",
      runner: { type: "machine", machineId, name: "studio" },
      runnerName: "studio-0123456789ab",
    });
  });

  test("never rewinds a job when deliveries arrive out of order", async () => {
    const { cookie, installationId, runId } = await connectedWorkspace();
    await processWebhook(
      env,
      jobEvent(installationId, { id: runId + 1, runId, name: "pick", labels: ["relayrunner"] }),
    );
    const test = { id: runId + 2, runId, name: "test", labels: ["ubuntu-latest"] };
    await processWebhook(
      env,
      jobEvent(
        installationId,
        { ...test, conclusion: "success", runnerName: "GitHub Actions 4" },
        "completed",
      ),
    );
    await processWebhook(env, jobEvent(installationId, test, "in_progress"));
    await processWebhook(env, jobEvent(installationId, test, "queued"));

    const [job] = (await activity(cookie)).jobs;
    expect(job).toMatchObject({
      status: "completed",
      conclusion: "success",
      runnerName: "GitHub Actions 4",
    });
  });

  test("ignores jobs from runs with no pick", async () => {
    const { cookie, installationId, runId } = await connectedWorkspace();
    await processWebhook(
      env,
      jobEvent(installationId, { id: runId + 1, runId, name: "lint", labels: ["ubuntu-latest"] }),
    );
    expect((await activity(cookie)).jobs).toEqual([]);
  });

  test("shows only the active workspace's jobs", async () => {
    const mine = await connectedWorkspace();
    const theirs = await connectedWorkspace();
    for (const { installationId, runId } of [mine, theirs]) {
      await processWebhook(
        env,
        jobEvent(installationId, { id: runId + 1, runId, name: "pick", labels: ["relayrunner"] }),
      );
      await processWebhook(
        env,
        jobEvent(installationId, {
          id: runId + 2,
          runId,
          name: "test",
          labels: ["ubuntu-latest"],
        }),
      );
    }
    const { jobs } = await activity(mine.cookie);
    expect(jobs.map((job) => job.id)).toEqual([mine.runId + 2]);
  });

  test("pages with a before cursor", async () => {
    const { cookie, installationId, runId } = await connectedWorkspace();
    await processWebhook(
      env,
      jobEvent(installationId, { id: runId + 1, runId, name: "pick", labels: ["relayrunner"] }),
    );
    for (let i = 0; i < 51; i += 1)
      await processWebhook(
        env,
        jobEvent(installationId, {
          id: runId * 100 + i,
          runId,
          name: `test ${i}`,
          labels: ["ubuntu-latest"],
        }),
      );
    const first = await activity(cookie);
    expect(first.jobs).toHaveLength(50);
    expect(first.jobs[0].name).toBe("test 50");
    expect(first.nextBefore).toBe(runId * 100 + 1);
    const second = await activity(cookie, `?before=${first.nextBefore}`);
    expect(second.jobs.map((job) => job.name)).toEqual(["test 0"]);
    expect(second.nextBefore).toBeNull();

    const bad = await testing.call(env, "/activity?before=nope", cookie);
    expect(bad.status).toBe(400);
  });
});
