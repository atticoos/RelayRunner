import { api, SetupError } from "./system.ts";
import { registeredRunner, runnerLabel, withRunnerLock } from "./runner.ts";
import { workflows } from "./workflows.ts";

import type { ActionsVariable } from "./system.ts";
import type { Repository } from "./workflows.ts";

export type RoutingMode = "local" | "hosted" | "status";

interface WorkflowRunJob {
  id: number;
  name: string;
  status: string;
  labels: string[];
  html_url: string;
}

const refKey = "RELAYRUNNER_REF";
const labelKey = "RELAYRUNNER_LABEL";

function pages<T>(endpoint: string, query = "") {
  return api<T[]>(`${endpoint}?per_page=100${query}`, ["--paginate", "--slurp"]);
}

function setVariable(
  endpoint: string,
  variables: Map<string, string>,
  name: string,
  value: string,
) {
  if (variables.get(name) === value) return;
  if (variables.has(name)) {
    api(`${endpoint}/${name}`, ["-X", "PATCH", "-f", `value=${value}`]);
  } else {
    api(endpoint, ["-X", "POST", "-f", `name=${name}`, "-f", `value=${value}`]);
  }
}

function queuedJobs(actions: string, label: string | null) {
  if (!label) return [];
  const runIds = new Set(
    ["queued", "in_progress"].flatMap((status) =>
      pages<{ workflow_runs: { id: number }[] }>(`${actions}/runs`, `&status=${status}`).flatMap(
        (page) => page.workflow_runs.map((run) => run.id),
      ),
    ),
  );
  return [...runIds]
    .flatMap((id) =>
      pages<{ jobs: WorkflowRunJob[] }>(`${actions}/runs/${id}/jobs`).flatMap((page) => page.jobs),
    )
    .filter(
      (job) =>
        job.status === "queued" &&
        job.labels.some((item) => item.toLowerCase() === label.toLowerCase()),
    )
    .map(({ id, name, html_url: url }) => ({ id, name, url }));
}

function routing(target: Repository, mode: RoutingMode) {
  const actions = `repos/${target.repo}/actions`;
  const endpoint = `${actions}/variables`;
  const variables = new Map(
    pages<{ variables: ActionsVariable[] }>(endpoint)
      .flatMap((page) => page.variables)
      .map(({ name, value }) => [name, value]),
  );
  const label = variables.get(labelKey);

  if (mode === "hosted") {
    for (const name of [labelKey, refKey]) {
      if (variables.has(name)) api(`${endpoint}/${name}`, ["-X", "DELETE"]);
    }
    const result = { repo: target.repo, route: "hosted" };
    try {
      return { ...result, queuedJobs: queuedJobs(actions, label || runnerLabel(target)) };
    } catch (error) {
      if (!(error instanceof SetupError)) throw error;
      return {
        ...result,
        queuedJobs: null,
        warning: `Could not check queued jobs. ${error.message}`,
      };
    }
  }

  const localLabel = runnerLabel(target);
  if (mode === "local" && label && label !== localLabel) {
    throw new SetupError(
      "ROUTE_CONFLICT",
      `Local routing already targets ${label}. Run relayrunner switch hosted first.`,
    );
  }

  const selectedLabel = label || localLabel;
  const runner = registeredRunner(target, selectedLabel);
  const online =
    runner?.status === "online" && runner.labels?.some((item) => item.name === selectedLabel);
  const availability = !selectedLabel
    ? null
    : online
      ? runner.busy
        ? "busy"
        : "online"
      : "offline";
  const runnerStatus = selectedLabel ? { label: selectedLabel, status: availability } : null;

  if (mode === "status") {
    return { repo: target.repo, route: label ? "local" : "hosted", runner: runnerStatus };
  }

  if (!online || !localLabel)
    throw new SetupError(
      "RUNNER_OFFLINE",
      "Set up this checkout and verify its local runner is online before switching.",
    );
  if (!workflows(target.root).some((job) => job.alreadySetUp && !job.needsUpdate)) {
    throw new SetupError(
      "WORKFLOW_SETUP_REQUIRED",
      "Set up or upgrade at least one eligible job and commit and push the workflow changes.",
    );
  }
  if (variables.has(refKey)) api(`${endpoint}/${refKey}`, ["-X", "DELETE"]);
  setVariable(endpoint, variables, labelKey, localLabel);
  return { repo: target.repo, route: "local", runner: runnerStatus };
}

export function routeJobs(target: Repository, mode: RoutingMode) {
  return mode === "status"
    ? routing(target, mode)
    : withRunnerLock(target, () => routing(target, mode));
}
