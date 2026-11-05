import type { RunnerOrder } from "@relayrunner/runner-order";
import { ApiError, api } from "@/lib/api";

/** GET/PUT /api/workspaces/:id/runner-order. `isDefault` until the workspace saves one. */
export type RunnerOrderResponse = { order: RunnerOrder; isDefault: boolean };

export function getRunnerOrder(workspaceId: string) {
  return api<RunnerOrderResponse>(`/workspaces/${encodeURIComponent(workspaceId)}/runner-order`);
}

export async function saveRunnerOrder(workspaceId: string, order: RunnerOrder) {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/runner-order`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      issues?: { message: string }[];
    } | null;
    throw new RunnerOrderError(res.status, body?.error, body?.issues?.[0]?.message);
  }
  return (await res.json()) as RunnerOrderResponse;
}

/** A failed save. `reason` is the API's first validation message, when it sent one. */
export class RunnerOrderError extends ApiError {
  constructor(
    status: number,
    code?: string,
    readonly reason?: string,
  ) {
    super(`Saving the runner order failed (${status})`, status, code);
  }
}
