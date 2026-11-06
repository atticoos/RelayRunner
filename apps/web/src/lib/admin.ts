import { api } from "@/lib/api";

/** Operator admin over users and workspaces (apps/api/src/routes/admin.ts). */
export type UserRole = "operator" | null;

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: UserRole;
  createdAt: string;
  /** How many workspaces they belong to. */
  workspaces: number;
};

export type AdminWorkspace = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  members: { userId: string; name: string; email: string; role: string }[];
  githubAccounts: string[];
};

export function listUsers() {
  return api<{ users: AdminUser[] }>("/admin/users");
}

export function setUserRole(id: string, role: UserRole) {
  return api<{ user: { id: string; role: UserRole } }>(`/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function listWorkspaces() {
  return api<{ workspaces: AdminWorkspace[] }>("/admin/workspaces");
}
