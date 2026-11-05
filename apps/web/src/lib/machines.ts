import { ApiError, api } from "@/lib/api";

/** A machine enrolled with `relayrunner connect` (GET /api/machines). */
export type Machine = {
  id: string;
  name: string;
  os: "linux" | "macos" | "windows" | null;
  arch: "x64" | "arm64" | "arm" | null;
  /**
   * The runner labels a job's `machine:` input matches against, in GitHub's spellings, such as
   * `["self-hosted", "macOS", "ARM64"]`. Missing from an API that predates them.
   */
  labels?: string[];
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /**
   * Set while paused: jobs skip the machine, but it stays connected. `by` is who paused it, or
   * null when its own CLI did. Missing from an API that predates pausing.
   */
  paused?: { at: string; by: string | null } | null;
  /** Whether the signed-in user may revoke it. Missing from an API that predates roles. */
  canRevoke?: boolean;
  /** Live, from the machine's connection. Online once it has said hello. */
  status?: {
    online: boolean;
    state: "idle" | "busy" | null;
    /** Epoch ms of the current connection. */
    connectedAt: number | null;
  };
};

export function listMachines() {
  return api<{ machines: Machine[] }>("/machines");
}

/** "just now", "5 minutes ago", "3 days ago". */
export function timeAgo(date: string | number, now = Date.now()) {
  const seconds = Math.round((new Date(date).getTime() - now) / 1000);
  if (seconds > -45) return "just now";
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(-1, "minute");
}

/** Pauses the machine: it stays connected, but jobs skip it until it's resumed. */
export function pauseMachine(id: string) {
  return api<{ machine: Machine }>(`/machines/${encodeURIComponent(id)}/pause`, {
    method: "POST",
  });
}

/** Lets jobs route to a paused machine again. */
export function resumeMachine(id: string) {
  return api<{ machine: Machine }>(`/machines/${encodeURIComponent(id)}/resume`, {
    method: "POST",
  });
}

/** Revokes the machine's token. Its CLI has to run `relayrunner connect` again. */
export function revokeMachine(id: string) {
  return api<{ machine: Machine }>(`/machines/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** GET /api/auth/device: a device code's state. Opening it also ties it to the signed-in user. */
export type DeviceCodeStatus = { user_code: string; status: "pending" | "approved" | "denied" };

export async function openDeviceCode(userCode: string) {
  const res = await fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(`Device code lookup failed`, res.status, body?.error);
  }
  return (await res.json()) as DeviceCodeStatus;
}

export function approveDevice(body: { userCode: string; workspaceId: string; name: string }) {
  return api<{ machineId: string }>("/machines/approve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function denyDevice(userCode: string) {
  return api<{ success: boolean }>("/auth/device/deny", {
    method: "POST",
    body: JSON.stringify({ userCode }),
  });
}

/** "ABCDEFGH" -> "ABCD-EFGH", the way the CLI prints it. */
export function formatUserCode(userCode: string) {
  const code = userCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** What a device-flow error code means for the person at the approval page. */
export function describeDeviceError(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  switch (code) {
    case "invalid_request":
      return "That code doesn't match a sign-in request. Check it against your terminal.";
    case "expired_token":
      return "That code has expired. Run `relayrunner connect` again for a new one.";
    case "already_processed":
    case "device_code_already_processed":
      return "That code has already been used.";
    case "forbidden":
    case "access_denied":
      return "You can't approve this request. It was opened by another account, or you aren't an owner of that workspace.";
    default:
      return "Something went wrong. Try again.";
  }
}
