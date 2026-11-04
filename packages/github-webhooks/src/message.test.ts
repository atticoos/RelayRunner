import { describe, expect, test } from "vitest";
import { toWebhookMessage } from "./message.ts";

describe("toWebhookMessage", () => {
  test("returns null for events RelayRunner ignores or payloads missing what it needs", () => {
    expect(toWebhookMessage("star", "d", { action: "created" })).toBeNull();
    expect(toWebhookMessage("workflow_job", "d", null)).toBeNull();
    expect(
      toWebhookMessage("workflow_job", "d", { action: "queued", repository: { full_name: "a/b" } }),
    ).toBeNull();
  });

  test("keeps only the installation repo fields", () => {
    const message = toWebhookMessage(
      "installation_repositories",
      "d",
      {
        action: "added",
        installation: { id: 7 },
        repositories_added: [{ id: 1, full_name: "acme/app", private: true, node_id: "x" }],
        repositories_removed: [],
      },
      "2026-11-04T00:00:00Z",
    );
    expect(message).toEqual({
      deliveryId: "d",
      action: "added",
      installationId: 7,
      receivedAt: "2026-11-04T00:00:00Z",
      event: "installation_repositories",
      installation: { id: 7, account: null, repositorySelection: "all", suspendedAt: null },
      added: [{ id: 1, fullName: "acme/app", private: true }],
      removed: [],
    });
  });

  test("summarizes the installation so the consumer can track its status", () => {
    const installation = {
      id: 7,
      account: { id: 10, login: "acme", type: "Organization", avatar_url: "x" },
      repository_selection: "all",
      suspended_at: "2026-11-04T12:00:00Z",
      permissions: {},
    };
    expect(
      toWebhookMessage("installation", "d", { action: "suspend", installation }),
    ).toMatchObject({
      installation: {
        id: 7,
        account: { id: 10, login: "acme", type: "Organization" },
        repositorySelection: "all",
        suspendedAt: "2026-11-04T12:00:00Z",
      },
    });
    // installation_repositories carries the new selection at the top level.
    expect(
      toWebhookMessage("installation_repositories", "d", {
        action: "removed",
        repository_selection: "selected",
        installation,
      }),
    ).toMatchObject({
      installation: { repositorySelection: "selected" },
    });
  });

  test("keeps only the repo fields of a repository event, and skips one without a repo", () => {
    const repository = {
      id: 3,
      name: "app",
      full_name: "acme/app",
      private: false,
      owner: { login: "acme" },
    };
    expect(
      toWebhookMessage(
        "repository",
        "d",
        { action: "renamed", repository, installation: { id: 7 } },
        "2026-11-04T00:00:00Z",
      ),
    ).toEqual({
      deliveryId: "d",
      action: "renamed",
      installationId: 7,
      receivedAt: "2026-11-04T00:00:00Z",
      event: "repository",
      repository: { id: 3, fullName: "acme/app", private: false },
    });
    expect(
      toWebhookMessage("repository", "d", {
        action: "created",
        repository: { full_name: "acme/app" },
      }),
    ).toBeNull();
  });
});
