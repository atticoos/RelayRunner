// The queue message for one verified GitHub delivery. The ingress Worker builds it and the API
// Worker's queue consumer reads it.
//
// It carries only the fields RelayRunner acts on, never the raw payload: a Cloudflare Queues
// message is capped at 128 KB, and GitHub payloads can be much larger. Add a field here when the
// consumer needs it.

export interface WorkflowJob {
  id: number;
  runId: number;
  runAttempt: number;
  name: string;
  workflowName: string | null;
  status: string;
  conclusion: string | null;
  labels: string[];
  headBranch: string | null;
  headSha: string;
  runnerName: string | null;
  createdAt: string;
  // Absent on messages from an ingress that predates them.
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface InstallationRepo {
  id: number;
  fullName: string;
  private: boolean;
}

// The installation as GitHub describes it on installation events, so the consumer can keep each
// connected org's status current (account, suspension, which repos the App sees).
export interface InstallationSummary {
  id: number;
  account: { id: number; login: string; type: string } | null;
  repositorySelection: "all" | "selected";
  suspendedAt: string | null;
}

interface Base {
  // X-GitHub-Delivery. Unique per delivery; a manual redelivery reuses it.
  deliveryId: string;
  action: string | null;
  installationId: number | null;
  // When the ingress Worker accepted the delivery, so the consumer can tell how long it waited.
  receivedAt: string;
}

export type WebhookMessage =
  | (Base & {
      event: "workflow_job";
      repository: { id: number; fullName: string };
      job: WorkflowJob;
    })
  | (Base & {
      event: "installation";
      installation: InstallationSummary | null;
      repositories: InstallationRepo[];
    })
  | (Base & {
      event: "installation_repositories";
      installation: InstallationSummary | null;
      added: InstallationRepo[];
      removed: InstallationRepo[];
    })
  // A repo the installation can see was created, renamed, made public or private, transferred,
  // deleted, and so on. For "All repositories" installs it is the only event that reports new repos.
  | (Base & { event: "repository"; repository: InstallationRepo });

// Delivery → queue message, or null when RelayRunner doesn't act on this event (or the payload is
// missing what it needs). Never throws.
export function toWebhookMessage(
  event: string,
  deliveryId: string,
  payload: unknown,
  receivedAt = new Date().toISOString(),
): WebhookMessage | null {
  if (!isRecord(payload)) return null;
  const base: Base = {
    deliveryId,
    action: typeof payload.action === "string" ? payload.action : null,
    installationId:
      isRecord(payload.installation) && typeof payload.installation.id === "number"
        ? payload.installation.id
        : null,
    receivedAt,
  };

  switch (event) {
    case "workflow_job": {
      const job = payload.workflow_job;
      const repo = payload.repository;
      if (
        !isRecord(job) ||
        !isRecord(repo) ||
        typeof job.id !== "number" ||
        typeof repo.full_name !== "string"
      )
        return null;
      return {
        ...base,
        event,
        repository: { id: Number(repo.id), fullName: repo.full_name },
        job: {
          id: job.id,
          runId: Number(job.run_id),
          runAttempt: Number(job.run_attempt ?? 1),
          name: String(job.name ?? ""),
          workflowName: stringOrNull(job.workflow_name),
          status: String(job.status ?? ""),
          conclusion: stringOrNull(job.conclusion),
          labels: Array.isArray(job.labels)
            ? job.labels.filter((label): label is string => typeof label === "string")
            : [],
          headBranch: stringOrNull(job.head_branch),
          headSha: String(job.head_sha ?? ""),
          runnerName: stringOrNull(job.runner_name),
          createdAt: String(job.created_at ?? ""),
          startedAt: stringOrNull(job.started_at),
          completedAt: stringOrNull(job.completed_at),
        },
      };
    }
    case "installation":
      return {
        ...base,
        event,
        installation: installationSummary(payload.installation),
        repositories: repos(payload.repositories),
      };
    case "installation_repositories":
      return {
        ...base,
        event,
        // The new selection comes at the top level of this event.
        installation: installationSummary(payload.installation, payload.repository_selection),
        added: repos(payload.repositories_added),
        removed: repos(payload.repositories_removed),
      };
    case "repository": {
      const repo = payload.repository;
      if (!isRecord(repo) || typeof repo.id !== "number" || typeof repo.full_name !== "string")
        return null;
      return {
        ...base,
        event,
        repository: { id: repo.id, fullName: repo.full_name, private: repo.private === true },
      };
    }
    default:
      return null;
  }
}

function installationSummary(value: unknown, selection?: unknown): InstallationSummary | null {
  if (!isRecord(value) || typeof value.id !== "number") return null;
  const account =
    isRecord(value.account) && typeof value.account.login === "string"
      ? {
          id: Number(value.account.id),
          login: value.account.login,
          type: String(value.account.type ?? "User"),
        }
      : null;
  const picked = selection ?? value.repository_selection;
  return {
    id: value.id,
    account,
    repositorySelection: picked === "selected" ? "selected" : "all",
    suspendedAt: stringOrNull(value.suspended_at),
  };
}

function repos(value: unknown): InstallationRepo[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((repo) => ({
    id: Number(repo.id),
    fullName: String(repo.full_name),
    private: repo.private === true,
  }));
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
